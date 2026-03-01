import { awscdk } from 'projen';
import { GithubCredentials } from 'projen/lib/github';
import { CdkDiffStackWorkflow, CdkDriftDetectionWorkflow } from '@jjrawlins/cdk-diff-pr-github-action';

const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.189.1',
  defaultReleaseBranch: 'main',
  name: 'cdk-diff-pr-github-action-tester-monorepo',
  projenrcTs: true,
  github: true,
  githubOptions: {
    projenCredentials: GithubCredentials.fromApp({
      appIdSecret: 'PROJEN_APP_ID',
      privateKeySecret: 'PROJEN_APP_PRIVATE_KEY',
    }),
  },
  deps: [
    '@jjrawlins/cdk-diff-pr-github-action',
  ],
});

// ---- CDK Diff Workflows (with workingDirectory) ----

new CdkDiffStackWorkflow({
  project,
  workingDirectory: 'infra',
  oidcRoleArn: 'arn:aws:iam::111122223333:role/GitHubOidcRole',
  oidcRegion: 'us-east-1',
  stacks: [
    {
      stackName: 'MonorepoTestStack-dev',
      changesetRoleToAssumeArn: 'arn:aws:iam::111122223333:role/cdk-diff-workflow-iam-role',
      changesetRoleToAssumeRegion: 'us-east-1',
    },
    {
      stackName: 'MonorepoTestStack-prod',
      changesetRoleToAssumeArn: 'arn:aws:iam::444455556666:role/cdk-diff-workflow-iam-role',
      changesetRoleToAssumeRegion: 'us-east-1',
    },
  ],
});

// ---- CDK Drift Detection Workflow (with workingDirectory) ----

new CdkDriftDetectionWorkflow({
  project,
  workingDirectory: 'infra',
  oidcRoleArn: 'arn:aws:iam::111122223333:role/GitHubOidcRole',
  oidcRegion: 'us-east-1',
  schedule: '0 6 * * 1', // Every Monday at 6am UTC
  stacks: [
    {
      stackName: 'MonorepoTestStack-dev',
      driftDetectionRoleToAssumeArn: 'arn:aws:iam::111122223333:role/cdk-drift-detection-role',
      driftDetectionRoleToAssumeRegion: 'us-east-1',
    },
    {
      stackName: 'MonorepoTestStack-prod',
      driftDetectionRoleToAssumeArn: 'arn:aws:iam::444455556666:role/cdk-drift-detection-role',
      driftDetectionRoleToAssumeRegion: 'us-east-1',
    },
  ],
});

project.synth();
