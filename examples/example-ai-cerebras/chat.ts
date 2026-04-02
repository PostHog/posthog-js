/** Cerebras chat completions via OpenAI-compatible API, tracked by PostHog. */

import { PostHog } from "posthog-node";
import { OpenAI } from "@posthog/ai/openai";

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
});
const client = new OpenAI({
  baseURL: "https://api.cerebras.ai/v1",
  apiKey: process.env.CEREBRAS_API_KEY!,
  posthog: phClient,
});

async function main() {
  const response = await client.chat.completions.create({
    model: "llama-3.3-70b",
    max_completion_tokens: 1024,
    posthogDistinctId: "example-user",
    messages: [
      { role: "user", content: "Tell me a fun fact about hedgehogs." },
    ],
  });

  console.log(response.choices[0].message.content);
  await phClient.shutdown();
}

main();
