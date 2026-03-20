/** Anthropic chat with tool calling, tracked by PostHog. */

import { PostHog } from "posthog-node";
import { Anthropic } from "@posthog/ai/anthropic";

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
});
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  posthog: phClient,
});

const tools: Anthropic.Messages.Tool[] = [
  {
    name: "get_weather",
    description: "Get current weather for a location",
    input_schema: {
      type: "object" as const,
      properties: {
        latitude: { type: "number" },
        longitude: { type: "number" },
        location_name: { type: "string" },
      },
      required: ["latitude", "longitude", "location_name"],
    },
  },
];

async function getWeather(latitude: number, longitude: number, locationName: string): Promise<string> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`;
  const resp = await fetch(url);
  const data = await resp.json();
  const current = data.current;
  return `Weather in ${locationName}: ${current.temperature_2m}°C, humidity ${current.relative_humidity_2m}%, wind ${current.wind_speed_10m} km/h`;
}

async function main() {
  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    posthogDistinctId: "example-user",
    tools,
    messages: [
      { role: "user", content: "What's the weather like in Dublin, Ireland?" },
    ],
  });

  // In production, send tool results back to the model for a final response.
  for (const block of response.content) {
    if (block.type === "text") {
      console.log(block.text);
    } else if (block.type === "tool_use") {
      const args = block.input as { latitude: number; longitude: number; location_name: string };
      const result = await getWeather(args.latitude, args.longitude, args.location_name);
      console.log(result);
    }
  }

  await phClient.shutdown();
}

main();
