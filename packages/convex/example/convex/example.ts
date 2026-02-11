import { posthog } from "./posthog.js";
import { action, mutation } from "./_generated/server.js";
import { v } from "convex/values";

// --- Fire-and-forget methods (mutations) ---
// When the identify callback is configured, distinctId is resolved automatically
// from the signed-in user. Pass distinctId explicitly to override or when the
// user is not signed in.

export const testCapture = mutation({
  args: {
    distinctId: v.optional(v.string()),
    event: v.string(),
    properties: v.optional(v.any()),
    groups: v.optional(v.any()),
    sendFeatureFlags: v.optional(v.boolean()),
    timestamp: v.optional(v.string()),
    uuid: v.optional(v.string()),
    disableGeoip: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await posthog.capture(ctx, {
      distinctId: args.distinctId,
      event: args.event,
      properties: args.properties,
      groups: args.groups,
      sendFeatureFlags: args.sendFeatureFlags,
      timestamp: args.timestamp ? new Date(args.timestamp) : undefined,
      uuid: args.uuid || undefined,
      disableGeoip: args.disableGeoip,
    });
    return { success: true };
  },
});

export const testIdentify = mutation({
  args: {
    distinctId: v.optional(v.string()),
    properties: v.optional(v.any()),
    disableGeoip: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await posthog.identify(ctx, {
      distinctId: args.distinctId,
      properties: args.properties,
      disableGeoip: args.disableGeoip,
    });
    return { success: true };
  },
});

export const testGroupIdentify = mutation({
  args: {
    groupType: v.string(),
    groupKey: v.string(),
    properties: v.optional(v.any()),
    distinctId: v.optional(v.string()),
    disableGeoip: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await posthog.groupIdentify(ctx, {
      groupType: args.groupType,
      groupKey: args.groupKey,
      properties: args.properties,
      distinctId: args.distinctId || undefined,
      disableGeoip: args.disableGeoip,
    });
    return { success: true };
  },
});

export const testAlias = mutation({
  args: {
    distinctId: v.optional(v.string()),
    alias: v.string(),
    disableGeoip: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await posthog.alias(ctx, {
      distinctId: args.distinctId,
      alias: args.alias,
      disableGeoip: args.disableGeoip,
    });
    return { success: true };
  },
});

export const testCaptureException = mutation({
  args: {
    errorMessage: v.string(),
    errorType: v.optional(
      v.union(v.literal("error"), v.literal("string"), v.literal("object")),
    ),
    distinctId: v.optional(v.string()),
    additionalProperties: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    let error: unknown;
    switch (args.errorType ?? "error") {
      case "error":
        error = new Error(args.errorMessage);
        break;
      case "string":
        error = args.errorMessage;
        break;
      case "object":
        error = { message: args.errorMessage };
        break;
    }

    await posthog.captureException(ctx, {
      error,
      distinctId: args.distinctId || undefined,
      additionalProperties: args.additionalProperties,
    });
    return { success: true };
  },
});

// --- Feature flag methods (actions) ---

const featureFlagArgs = {
  distinctId: v.optional(v.string()),
  flagKey: v.string(),
  groups: v.optional(v.any()),
  personProperties: v.optional(v.any()),
  groupProperties: v.optional(v.any()),
  sendFeatureFlagEvents: v.optional(v.boolean()),
  disableGeoip: v.optional(v.boolean()),
};

function featureFlagOptions(args: {
  groups?: unknown;
  personProperties?: unknown;
  groupProperties?: unknown;
  sendFeatureFlagEvents?: boolean;
  disableGeoip?: boolean;
}) {
  return {
    groups: args.groups as Record<string, string> | undefined,
    personProperties: args.personProperties as
      | Record<string, string>
      | undefined,
    groupProperties: args.groupProperties as
      | Record<string, Record<string, string>>
      | undefined,
    sendFeatureFlagEvents: args.sendFeatureFlagEvents,
    disableGeoip: args.disableGeoip,
  };
}

export const testGetFeatureFlag = action({
  args: featureFlagArgs,
  handler: async (ctx, args) => {
    const value = await posthog.getFeatureFlag(ctx, {
      key: args.flagKey,
      distinctId: args.distinctId,
      ...featureFlagOptions(args),
    });
    return { flagKey: args.flagKey, value };
  },
});

export const testIsFeatureEnabled = action({
  args: featureFlagArgs,
  handler: async (ctx, args) => {
    const enabled = await posthog.isFeatureEnabled(ctx, {
      key: args.flagKey,
      distinctId: args.distinctId,
      ...featureFlagOptions(args),
    });
    return { flagKey: args.flagKey, enabled };
  },
});

export const testGetFeatureFlagPayload = action({
  args: {
    ...featureFlagArgs,
    matchValue: v.optional(v.union(v.boolean(), v.string())),
  },
  handler: async (ctx, args) => {
    const payload = await posthog.getFeatureFlagPayload(ctx, {
      key: args.flagKey,
      distinctId: args.distinctId,
      matchValue: args.matchValue,
      ...featureFlagOptions(args),
    });
    return { flagKey: args.flagKey, payload };
  },
});

export const testGetFeatureFlagResult = action({
  args: featureFlagArgs,
  handler: async (ctx, args) => {
    const result = await posthog.getFeatureFlagResult(ctx, {
      key: args.flagKey,
      distinctId: args.distinctId,
      ...featureFlagOptions(args),
    });
    return { flagKey: args.flagKey, result };
  },
});

export const testGetAllFlags = action({
  args: {
    distinctId: v.optional(v.string()),
    groups: v.optional(v.any()),
    personProperties: v.optional(v.any()),
    groupProperties: v.optional(v.any()),
    disableGeoip: v.optional(v.boolean()),
    flagKeys: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const flags = await posthog.getAllFlags(ctx, {
      distinctId: args.distinctId,
      groups: args.groups as Record<string, string> | undefined,
      personProperties: args.personProperties as
        | Record<string, string>
        | undefined,
      groupProperties: args.groupProperties as
        | Record<string, Record<string, string>>
        | undefined,
      disableGeoip: args.disableGeoip,
      flagKeys: args.flagKeys,
    });
    return { flags };
  },
});

export const testGetAllFlagsAndPayloads = action({
  args: {
    distinctId: v.optional(v.string()),
    groups: v.optional(v.any()),
    personProperties: v.optional(v.any()),
    groupProperties: v.optional(v.any()),
    disableGeoip: v.optional(v.boolean()),
    flagKeys: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const result = await posthog.getAllFlagsAndPayloads(ctx, {
      distinctId: args.distinctId,
      groups: args.groups as Record<string, string> | undefined,
      personProperties: args.personProperties as
        | Record<string, string>
        | undefined,
      groupProperties: args.groupProperties as
        | Record<string, Record<string, string>>
        | undefined,
      disableGeoip: args.disableGeoip,
      flagKeys: args.flagKeys,
    });
    return result;
  },
});
