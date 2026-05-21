import { CdkDeployPipeline } from '@jjrawlins/cdk-deploy-pr-github-action';
import {
  CdkDiffIamTemplate,
  CdkDiffStackWorkflow,
  CdkDriftDetectionWorkflow,
  CdkDriftIamTemplate,
} from '@jjrawlins/cdk-diff-pr-github-action';
import { awscdk, TextFile, YamlFile } from 'projen';
import { Dependabot, DependabotScheduleInterval, GithubCredentials, VersioningStrategy } from 'projen/lib/github';

const Environments = {
  devops: { account: '891377240835', region: 'us-east-2' },
  dev: { account: '590183750202', region: 'us-east-2' },
  prod: { account: '471112928747', region: 'us-east-2' },
};

const workflowNodeVersion = '24.x';

const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.189.1',
  defaultReleaseBranch: 'main',
  name: 'cdk-diff-pr-github-action-tester-monorepo',
  minNodeVersion: '24.x',
  projenrcTs: true,
  workflowBootstrapSteps: [
    {
      name: 'Install Aikido Safe-Chain 1.5.3 (in-flight malware scanner, 7d minimum age)',
      run: [
        'echo "SAFE_CHAIN_MINIMUM_PACKAGE_AGE_HOURS=168" >> $GITHUB_ENV',
        'curl -fsSL https://github.com/AikidoSec/safe-chain/releases/download/1.5.3/install-safe-chain.sh | sh -s -- --ci',
      ].join('\n'),
    },
    {
      name: 'configure aws credentials',
      uses: 'aws-actions/configure-aws-credentials@v4',
      with: {
        'role-to-assume': '${{ secrets.AWS_GITHUB_OIDC_ROLE }}',
        'role-duration-seconds': 900,
        'aws-region': '${{ secrets.AWS_GITHUB_OIDC_REGION }}',
        'role-skip-session-tagging': true,
        'role-session-name': 'GitHubActions',
      },
    },
  ],

  // Dependency upgrades are handled by Dependabot (lockfile-only + cooldown).
  depsUpgrade: false,

  // Frozen-lockfile in CI so Dependabot lockfile-only PRs don't trigger
  // cosmetic self-mutation.
  buildWorkflowOptions: {
    mutableBuild: false,
  },
  deps: [
    '@jjrawlins/cdk-diff-pr-github-action@*',
    '@jjrawlins/cdk-deploy-pr-github-action',
  ],
  devDeps: [
    '@stylistic/eslint-plugin@^5',
  ],
  tsconfig: {
    compilerOptions: {
      strict: true,
      strictPropertyInitialization: false,
      rootDir: '.',
    },
  },
  tsconfigDev: {
    compilerOptions: {
      strict: true,
      strictPropertyInitialization: false,
      rootDir: '.',
    },
  },
  githubOptions: {
    projenCredentials: GithubCredentials.fromApp({
      appIdSecret: 'PROJEN_APP_ID',
      privateKeySecret: 'PROJEN_APP_PRIVATE_KEY',
    }),
    mergify: false,
    pullRequestLintOptions: {
      semanticTitleOptions: {
        types: [
          'feat', 'fix', 'docs', 'style', 'refactor',
          'perf', 'test', 'chore', 'revert', 'ci',
        ],
      },
    },
  },
  gitignore: [
    '.env',
    'infra/node_modules',
    'infra/cdk.out',
    'infra/lib',
  ],
});

// ---- CDK Diff Workflows (with workingDirectory: 'infra') ----

new CdkDiffStackWorkflow({
  project,
  workingDirectory: 'infra',
  oidcRoleArn: `arn:aws:iam::${Environments.devops.account}:role/GitHubActionsOidcRoleDevOps`,
  oidcRegion: Environments.devops.region,
  stacks: [
    {
      stackName: 'MonorepoTestStack-dev',
      changesetRoleToAssumeArn: `arn:aws:iam::${Environments.dev.account}:role/cdk-diff-workflow-iam-role`,
      changesetRoleToAssumeRegion: Environments.dev.region,
    },
    {
      stackName: 'MonorepoTestStack-prod',
      changesetRoleToAssumeArn: `arn:aws:iam::${Environments.prod.account}:role/cdk-diff-workflow-iam-role`,
      changesetRoleToAssumeRegion: Environments.prod.region,
    },
  ],
  nodeVersion: workflowNodeVersion,
  preGitHubSteps: ({ stack, workingDirectory }: { stack: string; workingDirectory?: string }) => [
    {
      name: `Notify Slack - Diff Starting (${stack})`,
      uses: 'slackapi/slack-github-action@v2.1.1',
      with: {
        'webhook': '${{ secrets.CDK_NOTIFICATIONS_SLACK_WEBHOOK }}',
        'webhook-type': 'incoming-webhook',
        'payload': `text: "CDK Diff starting for *${stack}* (wd: ${workingDirectory ?? 'root'}) on PR #\${{ github.event.pull_request.number }}"`,
      },
    },
  ],
  postGitHubSteps: ({ stack }: { stack: string; workingDirectory?: string }) => [
    {
      name: `Notify Slack - Diff Complete (${stack})`,
      uses: 'slackapi/slack-github-action@v2.1.1',
      if: 'always()',
      with: {
        'webhook': '${{ secrets.CDK_NOTIFICATIONS_SLACK_WEBHOOK }}',
        'webhook-type': 'incoming-webhook',
        'payload': `text: "CDK Diff completed for *${stack}* on PR #\${{ github.event.pull_request.number }}"`,
      },
    },
  ],
});

// ---- CDK Deploy Pipeline (with workingDirectory: 'infra') ----

new CdkDeployPipeline(project, {
  stackPrefix: 'MonorepoTestStack',
  iamRoleArn: `arn:aws:iam::${Environments.devops.account}:role/GitHubActionsOidcRoleDevOps`,
  iamRoleRegion: Environments.devops.region,
  pkgNamespace: '@JaysonRawlins',
  useGithubPackagesForAssembly: true,
  workingDirectory: 'infra',
  nodeVersion: workflowNodeVersion,
  stages: [
    {
      name: 'dev',
      env: Environments.dev,
      environment: 'development',
    },
    {
      name: 'prod',
      env: Environments.prod,
      environment: 'production',
      dependsOn: ['dev'],
      manualApproval: true,
    },
  ],
  preGitHubSteps: ({ stage, workingDirectory }: { stage: string; workingDirectory?: string }) => [
    {
      name: `Notify Slack - Deploy Starting (${stage})`,
      uses: 'slackapi/slack-github-action@v2.1.1',
      with: {
        'webhook': '${{ secrets.CDK_NOTIFICATIONS_SLACK_WEBHOOK }}',
        'webhook-type': 'incoming-webhook',
        'payload': `text: "CDK Deploy starting for *${stage}* (wd: ${workingDirectory ?? 'root'})"`,
      },
    },
  ],
  postGitHubSteps: ({ stage }: { stage: string; workingDirectory?: string }) => [
    {
      name: `Notify Slack - Deploy Complete (${stage})`,
      uses: 'slackapi/slack-github-action@v2.1.1',
      if: 'always()',
      with: {
        'webhook': '${{ secrets.CDK_NOTIFICATIONS_SLACK_WEBHOOK }}',
        'webhook-type': 'incoming-webhook',
        'payload': `text: "CDK Deploy completed for *${stage}* - outcome: \${{ steps.deploy.outcome }}"`,
      },
    },
  ],
});

// ---- CDK Drift Detection Workflow (with workingDirectory: 'infra') ----

new CdkDriftDetectionWorkflow({
  project,
  workingDirectory: 'infra',
  oidcRoleArn: `arn:aws:iam::${Environments.devops.account}:role/GitHubActionsOidcRoleDevOps`,
  oidcRegion: Environments.devops.region,
  stacks: [
    {
      stackName: 'MonorepoTestStack-dev',
      driftDetectionRoleToAssumeArn: `arn:aws:iam::${Environments.dev.account}:role/cdk-drift-workflow-iam-role`,
      driftDetectionRoleToAssumeRegion: Environments.dev.region,
    },
    {
      stackName: 'MonorepoTestStack-prod',
      driftDetectionRoleToAssumeArn: `arn:aws:iam::${Environments.prod.account}:role/cdk-drift-workflow-iam-role`,
      driftDetectionRoleToAssumeRegion: Environments.prod.region,
    },
  ],
  nodeVersion: workflowNodeVersion,
  preGitHubSteps: ({ stack, workingDirectory }: { stack: string; workingDirectory?: string }) => [
    {
      name: `Notify Slack - Drift Check Starting (${stack})`,
      uses: 'slackapi/slack-github-action@v2.1.1',
      with: {
        'webhook': '${{ secrets.CDK_NOTIFICATIONS_SLACK_WEBHOOK }}',
        'webhook-type': 'incoming-webhook',
        'payload': `text: "Drift detection starting for *${stack}* (wd: ${workingDirectory ?? 'root'})"`,
      },
    },
  ],
  postGitHubSteps: ({ stack }: { stack: string; workingDirectory?: string }) => [
    {
      name: `Notify Slack - Drift Detected (${stack})`,
      uses: 'slackapi/slack-github-action@v2.1.1',
      with: {
        'webhook': '${{ secrets.CDK_NOTIFICATIONS_SLACK_WEBHOOK }}',
        'webhook-type': 'incoming-webhook',
        'payload': [
          'text: "** ${{ env.STACK_NAME }} ** has drifted!"',
          'blocks:',
          '  - type: "section"',
          '    text:',
          '      type: "mrkdwn"',
          '      text: "*Stack:* ${{ env.STACK_NAME }} (region ${{ env.AWS_REGION }}) has drifted:exclamation:"',
          '  - type: "section"',
          '    fields:',
          '      - type: "mrkdwn"',
          '        text: "*Stack ARN*\\n${{ steps.drift.outputs.stack-arn }}"',
          '      - type: "mrkdwn"',
          '        text: "*Issue*\\n<${{ github.server_url }}/${{ github.repository }}/issues/${{ steps.issue.outputs.result }}|#${{ steps.issue.outputs.result }}>"',
        ].join('\n'),
      },
    },
  ],
});

// ---- IAM Templates ----

new CdkDiffIamTemplate({
  project,
  outputPath: 'cdk-diff-workflow-iam-template.yaml',
  oidcRegion: Environments.devops.region,
  oidcRoleArn: `arn:aws:iam::${Environments.devops.account}:role/GitHubActionsOidcRoleDevOps`,
  roleName: 'cdk-diff-workflow-iam-role',
});

new CdkDriftIamTemplate({
  project,
  outputPath: 'cdk-drift-workflow-iam-template.yaml',
  oidcRegion: Environments.devops.region,
  oidcRoleArn: `arn:aws:iam::${Environments.devops.account}:role/GitHubActionsOidcRoleDevOps`,
  roleName: 'cdk-drift-workflow-iam-role',
});

// ---- Workflow overrides ----

project.github!.tryFindWorkflow('build')!.file!.addOverride('jobs.build.permissions.id-token', 'write');
project.github!.tryFindWorkflow('build')!.file!.addOverride('jobs.build.permissions.packages', 'read');
project.github!.tryFindWorkflow('build')!.file!.addOverride('jobs.build.env.GITHUB_TOKEN', '${{ secrets.GITHUB_TOKEN }}');

// =========================================================================
// Security baseline — see ../.claude/projen-security-baseline.ts.
// =========================================================================

const prLintWorkflow = project.github!.tryFindWorkflow('pull-request-lint');
if (prLintWorkflow) {
  prLintWorkflow.file!.addOverride(
    'jobs.validate.steps.0.uses',
    'amannn/action-semantic-pull-request@48f256284bd46cdaab1048c3721360e808335d50', // v6.1.1
  );
}

const dependabot = new Dependabot(project.github!, {
  scheduleInterval: DependabotScheduleInterval.WEEKLY,
  versioningStrategy: VersioningStrategy.LOCKFILE_ONLY,
  labels: ['dependencies'],
  openPullRequestsLimit: 10,
  cooldown: {
    defaultDays: 7,
    semverMinorDays: 7,
    semverPatchDays: 3,
    include: ['*'],
  },
  groups: {
    'aws-sdk': { patterns: ['@aws-sdk/*', '@smithy/*'] },
    'typescript-eslint': { patterns: ['@typescript-eslint/*'] },
  },
});

dependabot.config.updates[0].ignore = [
  { 'dependency-name': 'projen' },
  { 'dependency-name': '*', 'update-types': ['version-update:semver-major'] },
];

dependabot.config.updates.push({
  'package-ecosystem': 'github-actions',
  'directory': '/',
  'schedule': { interval: 'weekly' },
  'open-pull-requests-limit': 0,
  'labels': ['dependencies', 'github-actions'],
});

// Drop any pre-existing hand-written security.yml; replace with the org-wide
// reusable osv-scanner gate.
project.tryRemoveFile('.github/workflows/security.yml');
new YamlFile(project, '.github/workflows/security.yml', {
  obj: {
    name: 'security',
    on: { pull_request: {}, workflow_dispatch: {} },
    jobs: {
      security: { uses: 'JaysonRawlins/.github/.github/workflows/security.yml@main' },
    },
  },
});

new YamlFile(project, '.github/workflows/semgrep.yml', {
  obj: {
    name: 'Semgrep',
    on: {
      push: { branches: ['main'] },
      pull_request: { branches: ['main'] },
    },
    permissions: { 'contents': 'read', 'security-events': 'write' },
    jobs: {
      scan: {
        name: 'Scan',
        'runs-on': 'ubuntu-latest',
        container: {
          image: 'semgrep/semgrep@sha256:9349edbadf90c3f3c0c3f55867625354e89680e6fa10d9034042af52fdb0e0d0',
        },
        steps: [
          { uses: 'actions/checkout@v4' },
          {
            name: 'Run Semgrep',
            run: [
              'semgrep scan \\',
              '  --config=p/security-audit \\',
              '  --config=p/typescript \\',
              '  --config=p/javascript \\',
              '  --config=p/nodejs \\',
              '  --sarif --output=semgrep.sarif \\',
              '  || true',
            ].join('\n'),
          },
          {
            name: 'Upload SARIF',
            if: "always() && hashFiles('semgrep.sarif') != ''",
            'continue-on-error': true,
            uses: 'github/codeql-action/upload-sarif@f411752efdf656cb71aa17b755b22c890960da1d', // v3.35.5
            with: { sarif_file: 'semgrep.sarif' },
          },
        ],
      },
    },
  },
});

new YamlFile(project, '.github/workflows/dependabot-automerge.yml', {
  obj: {
    name: 'dependabot-automerge',
    on: {
      pull_request_target: {
        types: ['opened', 'synchronize', 'reopened', 'ready_for_review'],
      },
    },
    permissions: { 'contents': 'write', 'pull-requests': 'write' },
    jobs: {
      automerge: {
        'runs-on': 'ubuntu-latest',
        'if': "github.actor == 'dependabot[bot]'",
        'steps': [
          {
            name: 'Get Dependabot metadata',
            id: 'metadata',
            uses: 'dependabot/fetch-metadata@21025c705c08248db411dc16f3619e6b5f9ea21a', // v2.5.0
            with: { 'github-token': '${{ secrets.GITHUB_TOKEN }}' },
          },
          {
            name: 'Enable auto-merge for safe Dependabot PRs',
            if: "steps.metadata.outputs.update-type == 'version-update:semver-patch' || steps.metadata.outputs.update-type == 'version-update:semver-minor'",
            run: 'gh pr merge --auto --squash "$PR_URL"',
            env: {
              PR_URL: '${{ github.event.pull_request.html_url }}',
              GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
            },
          },
        ],
      },
    },
  },
});

new YamlFile(project, '.github/workflows/dependabot-rebase-stuck.yml', {
  obj: {
    name: 'dependabot-unblocker',
    on: {
      schedule: [{ cron: '0 9 * * 1' }],
      workflow_dispatch: {},
    },
    permissions: { 'pull-requests': 'read', 'actions': 'write' },
    jobs: {
      unblock: {
        'runs-on': 'ubuntu-latest',
        'steps': [
          {
            name: 'Rerun failed build on Aikido-cooldown-blocked Dependabot PRs',
            env: {
              GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
              REPO: '${{ github.repository }}',
            },
            run: [
              'set -euo pipefail',
              '',
              'stuck=$(gh pr list --repo "$REPO" \\',
              '  --author "app/dependabot" \\',
              '  --state open \\',
              '  --json number,statusCheckRollup \\',
              '  --jq \'.[] | select([.statusCheckRollup[] | select(.name == "build")] | any(.conclusion == "FAILURE")) | .number\')',
              '',
              'if [ -z "$stuck" ]; then',
              '  echo "No stuck Dependabot PRs."',
              '  exit 0',
              'fi',
              '',
              'for pr in $stuck; do',
              '  run_id=$(gh pr view "$pr" --repo "$REPO" --json statusCheckRollup \\',
              '    --jq \'.statusCheckRollup[] | select(.name == "build") | .detailsUrl\' \\',
              '    | grep -oE "/runs/[0-9]+" | head -1 | cut -d/ -f3)',
              '',
              '  if [ -z "$run_id" ]; then',
              '    echo "PR #$pr: no build run id, skipping"',
              '    continue',
              '  fi',
              '',
              '  log=$(gh run view "$run_id" --repo "$REPO" --log-failed 2>&1 || true)',
              '',
              '  if echo "$log" | grep -q "minimum package age"; then',
              '    echo "PR #$pr: Aikido cooldown block — rerunning failed build (preserves lockfile)"',
              '    gh run rerun "$run_id" --repo "$REPO" --failed',
              '  elif echo "$log" | grep -q "Safe-chain: blocked"; then',
              '    echo "PR #$pr: Aikido blocked (non-age, possibly malware) — leaving for human review"',
              '  else',
              '    echo "PR #$pr: build failed for unrecognized reason — leaving for human review"',
              '  fi',
              'done',
            ].join('\n'),
          },
        ],
      },
    },
  },
});

project.package.addField('resolutions', {
  '@stylistic/eslint-plugin': '^5',
});

project.tryRemoveFile('.npmrc');
new TextFile(project, '.npmrc', {
  lines: [
    '# ~~ Generated by projen. To modify, edit .projenrc.ts and run "npx projen".',
    '',
    '@JaysonRawlins:registry=https://npm.pkg.github.com',
    '//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}',
  ],
});

project.synth();
