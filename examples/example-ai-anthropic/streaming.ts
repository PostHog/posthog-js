/** Anthropic streaming chat, tracked by PostHog. */

import { PostHog } from "posthog-node";
import { Anthropic } from "@posthog/ai";

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
});
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  posthog: phClient,
});

async function main() {
  const stream = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    posthogDistinctId: "example-user",
    stream: true,
    messages: [
      { role: "user", content: "Explain observability in three sentences." },
    ],
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      process.stdout.write(event.delta.text);
    }
  }

  console.log();
  await phClient.shutdown();
}

main();
