/** OpenAI Responses API with tool calling, tracked by PostHog. */

import { PostHog } from "posthog-node";
import { OpenAI } from "@posthog/ai/openai";

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
});
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  posthog: phClient,
});

const tools = [
  {
    type: "function" as const,
    name: "get_weather",
    description: "Get current weather for a location",
    parameters: {
      type: "object",
      properties: {
        latitude: { type: "number" },
        longitude: { type: "number" },
        location_name: { type: "string" },
      },
      required: ["latitude", "longitude", "location_name"],
    },
  },
];

async function getWeather(
  latitude: number,
  longitude: number,
  locationName: string
): Promise<string> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`;
  const resp = await fetch(url);
  const data = await resp.json();
  const current = data.current;
  return `Weather in ${locationName}: ${current.temperature_2m}°C, humidity ${current.relative_humidity_2m}%, wind ${current.wind_speed_10m} km/h`;
}

async function main() {
  const response = await client.responses.create({
    model: "gpt-4o-mini",
    max_output_tokens: 1024,
    posthogDistinctId: "example-user",
    tools,
    instructions: "You are a helpful assistant with access to weather data.",
    input: [{ role: "user", content: "What's the weather like in Tokyo?" }],
  });

  // In production, send tool results back to the model for a final response.
  for (const item of response.output) {
    if ("content" in item && Array.isArray(item.content)) {
      for (const content of item.content) {
        if ("text" in content) {
          console.log(content.text);
        }
      }
    } else if ("name" in item && "arguments" in item) {
      const args = JSON.parse(item.arguments as string);
      const result = await getWeather(
        args.latitude,
        args.longitude,
        args.location_name
      );
      console.log(result);
    }
  }

  await phClient.shutdown();
}

main();
