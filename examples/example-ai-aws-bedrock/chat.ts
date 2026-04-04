/** AWS Bedrock chat with OpenTelemetry instrumentation, tracked by PostHog. */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { Resource } from "@opentelemetry/resources";
import { PostHogTraceExporter } from "@posthog/ai/otel";
import { AwsInstrumentation } from "@opentelemetry/instrumentation-aws-sdk";

const sdk = new NodeSDK({
  resource: new Resource({
    "service.name": "example-bedrock-app",
  }),
  traceExporter: new PostHogTraceExporter({
    apiKey: process.env.POSTHOG_API_KEY!,
    host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
  }),
  instrumentations: [new AwsInstrumentation()],
});
sdk.start();

async function main() {
  // Import after sdk.start() so the instrumentation can patch the AWS SDK.
  const { BedrockRuntimeClient, ConverseCommand } = await import(
    "@aws-sdk/client-bedrock-runtime"
  );

  const client = new BedrockRuntimeClient({
    region: process.env.AWS_REGION || "us-east-1",
  });

  const response = await client.send(
    new ConverseCommand({
      modelId: "us.anthropic.claude-3-5-haiku-20241022-v1:0",
      messages: [
        {
          role: "user",
          content: [{ text: "Tell me a fun fact about hedgehogs." }],
        },
      ],
    })
  );

  console.log(response.output?.message?.content?.[0]?.text);
  await sdk.shutdown();
}

main();
