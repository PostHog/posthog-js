/** LangChain with PostHog callback handler for tracking LLM calls. */

import { PostHog } from "posthog-node";
import { LangChainCallbackHandler } from "@posthog/ai/langchain";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
});

const callbackHandler = new LangChainCallbackHandler({
  client: phClient,
  distinctId: "example-user",
});

const model = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0.7,
  openAIApiKey: process.env.OPENAI_API_KEY!,
});

async function main() {
  const response = await model.invoke(
    [new HumanMessage("Explain observability in three sentences.")],
    { callbacks: [callbackHandler] }
  );

  console.log(response.content);
  await phClient.shutdown();
}

main();
