/** OpenAI Responses API with streaming, tracked by PostHog. */

import { PostHog } from "posthog-node";
import { OpenAI } from "@posthog/ai";

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
});
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  posthog: phClient,
});

async function main() {
  const stream = await client.responses.create({
    model: "gpt-4o-mini",
    max_output_tokens: 1024,
    posthogDistinctId: "example-user",
    stream: true,
    instructions: "You are a helpful assistant.",
    input: [
      {
        role: "user",
        content: "Write a haiku about product analytics.",
      },
    ],
  });

  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      process.stdout.write(event.delta);
    }
  }

  console.log();
  await phClient.shutdown();
}

main();
