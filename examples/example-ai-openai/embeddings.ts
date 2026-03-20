/** OpenAI embeddings, tracked by PostHog. */

import { PostHog } from "posthog-node";
import { OpenAI } from "@posthog/ai/openai";

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
});
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  posthog: phClient,
});

async function main() {
  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: "PostHog is an open-source product analytics platform.",
    posthogDistinctId: "example-user",
  });

  const embedding = response.data[0].embedding;
  console.log(`Embedding dimensions: ${embedding.length}`);
  console.log(`First 5 values: ${embedding.slice(0, 5)}`);

  await phClient.shutdown();
}

main();
