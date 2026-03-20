/** Vercel AI streamText, tracked by PostHog. */

import { PostHog } from "posthog-node";
import { withTracing } from "@posthog/ai";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
});
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! });

async function main() {
  const model = withTracing(openai("gpt-4o-mini"), phClient, {
    posthogDistinctId: "example-user",
  });

  const result = streamText({
    model,
    prompt: "Explain observability in three sentences.",
  });

  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }

  console.log();
  await phClient.shutdown();
}

main();
