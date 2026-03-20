/** Gemini streaming chat, tracked by PostHog. */

import { PostHog } from "posthog-node";
import { GoogleGenAI } from "@posthog/ai";

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
});
const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
  posthog: phClient,
});

async function main() {
  const stream = client.models.generateContentStream({
    model: "gemini-2.5-flash",
    posthogDistinctId: "example-user",
    contents: "Explain observability in three sentences.",
  });

  for await (const chunk of stream) {
    const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      process.stdout.write(text);
    }
  }

  console.log();
  await phClient.shutdown();
}

main();
