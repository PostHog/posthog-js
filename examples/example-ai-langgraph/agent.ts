/** LangGraph agent with PostHog callback handler for tracking LLM calls. */

import { PostHog } from "posthog-node";
import { LangChainCallbackHandler } from "@posthog/ai/langchain";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
});

const callbackHandler = new LangChainCallbackHandler({
  client: phClient,
  distinctId: "example-user",
});

const getWeather = tool(
  (input) => `It's always sunny in ${input.city}!`,
  {
    name: "get_weather",
    description: "Get the weather for a given city",
    schema: z.object({
      city: z.string().describe("The city to get the weather for"),
    }),
  }
);

const model = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

async function main() {
  const agent = createReactAgent({ llm: model, tools: [getWeather] });

  const result = await agent.invoke(
    { messages: [{ role: "user", content: "What's the weather in Paris?" }] },
    { callbacks: [callbackHandler] }
  );

  console.log(result.messages[result.messages.length - 1].content);
  await phClient.shutdown();
}

main();
