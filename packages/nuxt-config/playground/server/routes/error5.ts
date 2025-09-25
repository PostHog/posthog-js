import { eventHandler } from "h3";

export default eventHandler((event) => {
  // This route intentionally throws an error for testing purposes
  throw new Error("Test error - 4");
});

// posthog-cli --host http://localhost:8010 sourcemap inject --directory ./.output
// posthog-cli --host http://localhost:8010 sourcemap upload --directory ./.output --version versionNitro7 --project projectNitro7

// posthog-cli --host https://internal-c.posthog.com sourcemap inject --directory ./.output
// posthog-cli --host https://internal-c.posthog.com sourcemap upload --directory ./.output --version versionNitro2 --project projectNitro2

// sleep 5

// npm run start
