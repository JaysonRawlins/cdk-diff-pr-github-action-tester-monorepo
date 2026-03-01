import { App, CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

class MonorepoTestStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const topic = new Topic(this, 'TestTopic');

    new Role(this, 'TestLambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        SNSPublish: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ['sns:Publish'],
              resources: [topic.topicArn],
            }),
          ],
        }),
      },
    });

    new CfnOutput(this, 'TopicArn', {
      value: topic.topicArn,
    });
  }
}

const app = new App();

new MonorepoTestStack(app, 'MonorepoTestStack-dev', {
  env: { account: '590183750202', region: 'us-east-2' },
});

new MonorepoTestStack(app, 'MonorepoTestStack-prod', {
  env: { account: '471112928747', region: 'us-east-2' },
});

app.synth();
