/** OpenAI image generation via Responses API, tracked by PostHog. */

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
  const response = await client.responses.create({
    model: "gpt-image-1-mini",
    input: "A hedgehog wearing a PostHog t-shirt, pixel art style",
    tools: [{ type: "image_generation" }],
    posthogDistinctId: "example-user",
  });

  for (const item of response.output) {
    if ("type" in item && item.type === "image_generation_call") {
      const imageBase64 = (item as any).result as string;
      console.log(`Generated image: ${imageBase64.length} chars of base64 data`);
    }
  }

  await phClient.shutdown();
}

main();
