/** OpenAI Chat Completions API with streaming, tracked by PostHog. */

import { PostHog } from "posthog-node";
import { OpenAI } from "@posthog/ai";

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
});
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  posthog: phClient,
});

async function main() {
  const stream = await client.chat.completions.create({
    model: "gpt-4o-mini",
    max_completion_tokens: 1024,
    posthogDistinctId: "example-user",
    stream: true,
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Explain observability in three sentences." },
    ],
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      process.stdout.write(content);
    }
  }

  console.log();
  await phClient.shutdown();
}

main();
