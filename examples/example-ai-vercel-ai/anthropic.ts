/** Vercel AI with Anthropic backend, tracked by PostHog. */

import { PostHog } from "posthog-node";
import { withTracing } from "@posthog/ai";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
});
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

async function main() {
  const model = withTracing(anthropic("claude-sonnet-4-5-20250929"), phClient, {
    posthogDistinctId: "example-user",
  });

  const { text } = await generateText({
    model,
    prompt: "Explain observability in three sentences.",
  });

  console.log(text);
  await phClient.shutdown();
}

main();
