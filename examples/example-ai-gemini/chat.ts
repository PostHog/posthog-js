/** Gemini chat with tool calling, tracked by PostHog. */

import { PostHog } from "posthog-node";
import { Gemini as GoogleGenAI } from "@posthog/ai/gemini";
import type { FunctionDeclaration, Type } from "@google/genai";

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
});
const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
  posthog: phClient,
});

const weatherTool: FunctionDeclaration = {
  name: "get_weather",
  description: "Get current weather for a location",
  parameters: {
    type: "OBJECT" as Type,
    properties: {
      latitude: { type: "NUMBER" as Type },
      longitude: { type: "NUMBER" as Type },
      location_name: { type: "STRING" as Type },
    },
    required: ["latitude", "longitude", "location_name"],
  },
};

async function getWeather(latitude: number, longitude: number, locationName: string): Promise<string> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`;
  const resp = await fetch(url);
  const data = await resp.json();
  const current = data.current;
  return `Weather in ${locationName}: ${current.temperature_2m}°C, humidity ${current.relative_humidity_2m}%, wind ${current.wind_speed_10m} km/h`;
}

async function main() {
  const response = await client.models.generateContent({
    model: "gemini-2.5-flash",
    posthogDistinctId: "example-user",
    contents: "What's the weather like in Dublin, Ireland?",
    config: {
      tools: [{ functionDeclarations: [weatherTool] }],
    },
  });

  // In production, send tool results back to the model for a final response.
  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.text) {
      console.log(part.text);
    } else if (part.functionCall) {
      const args = part.functionCall.args as { latitude: number; longitude: number; location_name: string };
      const result = await getWeather(args.latitude, args.longitude, args.location_name);
      console.log(result);
    }
  }

  await phClient.shutdown();
}

main();
