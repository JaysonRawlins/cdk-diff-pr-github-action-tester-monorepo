import {
  CdkDiffIamTemplate,
  CdkDiffStackWorkflow,
  CdkDriftDetectionWorkflow,
  CdkDriftIamTemplate,
} from '@jjrawlins/cdk-diff-pr-github-action';
import { CdkDeployPipeline } from '@jjrawlins/cdk-deploy-pr-github-action';
import { awscdk, TextFile } from 'projen';
import { GithubCredentials } from 'projen/lib/github';

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
  minNodeVersion: '20.0.0',
  projenrcTs: true,
  workflowBootstrapSteps: [
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
  depsUpgrade: true,
  depsUpgradeOptions: {
    workflowOptions: {
      projenCredentials: GithubCredentials.fromApp({
        appIdSecret: 'PROJEN_APP_ID',
        privateKeySecret: 'PROJEN_APP_PRIVATE_KEY',
      }),
    },
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

project.github!.tryFindWorkflow('upgrade')!.file!.addOverride('jobs.upgrade.permissions.id-token', 'write');
project.github!.tryFindWorkflow('upgrade')!.file!.addOverride('jobs.upgrade.permissions.packages', 'write');
project.github!.tryFindWorkflow('upgrade')!.file!.addOverride('jobs.upgrade.permissions.pull-requests', 'write');
project.github!.tryFindWorkflow('upgrade')!.file!.addOverride('jobs.upgrade.permissions.contents', 'write');
project.github!.tryFindWorkflow('upgrade')!.file!.addOverride('jobs.upgrade.env.GITHUB_TOKEN', '${{ secrets.GITHUB_TOKEN }}');

project.github!.tryFindWorkflow('upgrade')!.file!.addOverride('jobs.pr.permissions.id-token', 'write');
project.github!.tryFindWorkflow('upgrade')!.file!.addOverride('jobs.pr.permissions.packages', 'write');
project.github!.tryFindWorkflow('upgrade')!.file!.addOverride('jobs.pr.permissions.pull-requests', 'write');
project.github!.tryFindWorkflow('upgrade')!.file!.addOverride('jobs.pr.permissions.contents', 'write');

project.github!.tryFindWorkflow('upgrade')!.file!.addOverride('jobs.pr.steps.6', {
  name: 'Enable auto-merge',
  if: "steps.create-pr.outputs.pull-request-number != ''",
  run: 'gh pr merge --auto --squash "${{ steps.create-pr.outputs.pull-request-number }}"',
  env: {
    GH_TOKEN: '${{ steps.generate_token.outputs.token }}',
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
