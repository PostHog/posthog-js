/** Vercel AI with Google backend, tracked by PostHog. */

import { PostHog } from "posthog-node";
import { withTracing } from "@posthog/ai";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
});
const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });

async function main() {
  const model = withTracing(google("gemini-2.5-flash"), phClient, {
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
