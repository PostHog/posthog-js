/** Vercel AI generateObject for structured output, tracked by PostHog. */

import { PostHog } from "posthog-node";
import { withTracing } from "@posthog/ai";
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
});
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const WeatherSchema = z.object({
  location: z.string(),
  temperature: z.number().describe("Temperature in Celsius"),
  humidity: z.number().describe("Relative humidity percentage"),
  conditions: z.string().describe("Brief weather description"),
  windSpeed: z.number().describe("Wind speed in km/h"),
});

async function main() {
  const model = withTracing(openai("gpt-4o-mini"), phClient, {
    posthogDistinctId: "example-user",
  });

  const { object } = await generateObject({
    model,
    schema: WeatherSchema,
    prompt: "Describe typical weather in Dublin, Ireland in March.",
  });

  console.log("Location:", object.location);
  console.log("Temperature:", object.temperature, "°C");
  console.log("Humidity:", object.humidity, "%");
  console.log("Conditions:", object.conditions);
  console.log("Wind:", object.windSpeed, "km/h");

  await phClient.shutdown();
}

main();
