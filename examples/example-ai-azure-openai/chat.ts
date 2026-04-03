/** Azure OpenAI chat completions, tracked by PostHog. */

import { PostHog } from "posthog-node";
import { AzureOpenAI } from "@posthog/ai";

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
});
const client = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY!,
  apiVersion: "2024-10-21",
  endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
  posthog: phClient,
});

async function main() {
  const response = await client.chat.completions.create({
    model: "gpt-4o",
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
