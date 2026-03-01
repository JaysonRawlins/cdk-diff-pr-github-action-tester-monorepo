import { App, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';

class MonorepoTestStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new CfnOutput(this, 'Message', {
      value: `Hello from ${id}`,
    });
  }
}

const app = new App();

new MonorepoTestStack(app, 'MonorepoTestStack-dev', {
  env: { account: '111122223333', region: 'us-east-1' },
});

new MonorepoTestStack(app, 'MonorepoTestStack-prod', {
  env: { account: '444455556666', region: 'us-east-1' },
});

app.synth();
