import { PostHog } from "@posthog/convex";
import { components } from "./_generated/api";

export const posthog = new PostHog(components.posthog, {
  // Automatically resolve the current user's identity from Convex auth.
  // Falls back to an explicit distinctId if the user is not signed in.
  identify: async (ctx) => {
    const identity = await ctx.auth?.getUserIdentity();
    if (!identity) return null;
    return { distinctId: identity.subject };
  },
  beforeSend: (event) => {
    return {
      ...event,
      properties: {
        ...event.properties,
        environment: "example-app",
      },
    };
  },
});
