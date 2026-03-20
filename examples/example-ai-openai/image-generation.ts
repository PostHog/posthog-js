/** OpenAI image generation, tracked by PostHog. */

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
  // Note: @posthog/ai does not wrap images.generate yet,
  // so this call is not automatically tracked.
  const response = await client.images.generate({
    model: "gpt-image-1",
    prompt: "A hedgehog wearing a PostHog t-shirt, pixel art style",
    size: "1024x1024",
  });

  const imageBase64 = response.data[0].b64_json!;
  console.log(`Generated image: ${imageBase64.length} chars of base64 data`);

  await phClient.shutdown();
}

main();
