import type { FeatureFlagValue, JsonType } from "@posthog/core";
import { PostHog } from "posthog-node/edge";
import { action } from "./_generated/server.js";
import { v } from "convex/values";

function createClient(apiKey: string, host: string) {
  return new PostHog(apiKey, { host, flushAt: 1, flushInterval: 0 });
}

export const capture = action({
  args: {
    apiKey: v.string(),
    host: v.string(),
    distinctId: v.string(),
    event: v.string(),
    properties: v.optional(v.any()),
    groups: v.optional(v.any()),
    sendFeatureFlags: v.optional(v.boolean()),
    timestamp: v.optional(v.number()),
    uuid: v.optional(v.string()),
    disableGeoip: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    const client = createClient(args.apiKey, args.host);
    client.capture({
      distinctId: args.distinctId,
      event: args.event,
      properties: args.properties,
      groups: args.groups,
      sendFeatureFlags: args.sendFeatureFlags,
      timestamp: args.timestamp ? new Date(args.timestamp) : undefined,
      uuid: args.uuid,
      disableGeoip: args.disableGeoip,
    });
    await client.shutdown();
  },
});

export const identify = action({
  args: {
    apiKey: v.string(),
    host: v.string(),
    distinctId: v.string(),
    properties: v.optional(v.any()),
    disableGeoip: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    const client = createClient(args.apiKey, args.host);
    client.identify({
      distinctId: args.distinctId,
      properties: args.properties,
      disableGeoip: args.disableGeoip,
    });
    await client.shutdown();
  },
});

export const groupIdentify = action({
  args: {
    apiKey: v.string(),
    host: v.string(),
    groupType: v.string(),
    groupKey: v.string(),
    properties: v.optional(v.any()),
    distinctId: v.optional(v.string()),
    disableGeoip: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    const client = createClient(args.apiKey, args.host);
    client.groupIdentify({
      groupType: args.groupType,
      groupKey: args.groupKey,
      properties: args.properties,
      distinctId: args.distinctId,
      disableGeoip: args.disableGeoip,
    });
    await client.shutdown();
  },
});

export const alias = action({
  args: {
    apiKey: v.string(),
    host: v.string(),
    distinctId: v.string(),
    alias: v.string(),
    disableGeoip: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    const client = createClient(args.apiKey, args.host);
    client.alias({
      distinctId: args.distinctId,
      alias: args.alias,
      disableGeoip: args.disableGeoip,
    });
    await client.shutdown();
  },
});

export const captureException = action({
  args: {
    apiKey: v.string(),
    host: v.string(),
    distinctId: v.optional(v.string()),
    errorMessage: v.string(),
    errorStack: v.optional(v.string()),
    errorName: v.optional(v.string()),
    additionalProperties: v.optional(v.any()),
  },
  handler: async (_ctx, args) => {
    const client = createClient(args.apiKey, args.host);
    const error = new Error(args.errorMessage);
    if (args.errorName) error.name = args.errorName;
    if (args.errorStack) error.stack = args.errorStack;
    client.captureException(error, args.distinctId, args.additionalProperties);
    await client.shutdown();
  },
});

// Feature flag actions — these return values and must be called via ctx.runAction

const featureFlagArgs = {
  apiKey: v.string(),
  host: v.string(),
  key: v.string(),
  distinctId: v.string(),
  groups: v.optional(v.any()),
  personProperties: v.optional(v.any()),
  groupProperties: v.optional(v.any()),
  sendFeatureFlagEvents: v.optional(v.boolean()),
  disableGeoip: v.optional(v.boolean()),
};

function featureFlagOptions(args: {
  groups?: Record<string, string>;
  personProperties?: Record<string, string>;
  groupProperties?: Record<string, Record<string, string>>;
  sendFeatureFlagEvents?: boolean;
  disableGeoip?: boolean;
}) {
  return {
    groups: args.groups,
    personProperties: args.personProperties,
    groupProperties: args.groupProperties,
    sendFeatureFlagEvents: args.sendFeatureFlagEvents,
    disableGeoip: args.disableGeoip,
  };
}

export const getFeatureFlag = action({
  args: featureFlagArgs,
  handler: async (_ctx, args): Promise<FeatureFlagValue | null> => {
    const client = createClient(args.apiKey, args.host);
    const result = await client.getFeatureFlag(
      args.key,
      args.distinctId,
      featureFlagOptions(args),
    );
    await client.shutdown();
    return result ?? null;
  },
});

export const isFeatureEnabled = action({
  args: featureFlagArgs,
  handler: async (_ctx, args) => {
    const client = createClient(args.apiKey, args.host);
    const result = await client.isFeatureEnabled(
      args.key,
      args.distinctId,
      featureFlagOptions(args),
    );
    await client.shutdown();
    return result ?? null;
  },
});

export const getFeatureFlagPayload = action({
  args: {
    ...featureFlagArgs,
    matchValue: v.optional(v.union(v.string(), v.boolean())),
  },
  handler: async (_ctx, args): Promise<JsonType> => {
    const client = createClient(args.apiKey, args.host);
    const result = await client.getFeatureFlagPayload(
      args.key,
      args.distinctId,
      args.matchValue,
      featureFlagOptions(args),
    );
    await client.shutdown();
    return result ?? null;
  },
});

export const getFeatureFlagResult = action({
  args: featureFlagArgs,
  handler: async (
    _ctx,
    args,
  ): Promise<{
    key: string;
    enabled: boolean;
    variant: string | null;
    payload: JsonType | null;
  } | null> => {
    const client = createClient(args.apiKey, args.host);
    const result = await client.getFeatureFlagResult(
      args.key,
      args.distinctId,
      featureFlagOptions(args),
    );
    await client.shutdown();
    if (!result) return null;
    return {
      key: result.key,
      enabled: result.enabled,
      variant: result.variant ?? null,
      payload: result.payload ?? null,
    };
  },
});

const allFlagsArgs = {
  apiKey: v.string(),
  host: v.string(),
  distinctId: v.string(),
  groups: v.optional(v.any()),
  personProperties: v.optional(v.any()),
  groupProperties: v.optional(v.any()),
  disableGeoip: v.optional(v.boolean()),
  flagKeys: v.optional(v.array(v.string())),
};

export const getAllFlags = action({
  args: allFlagsArgs,
  handler: async (
    _ctx,
    args,
  ): Promise<Record<string, FeatureFlagValue>> => {
    const client = createClient(args.apiKey, args.host);
    const result = await client.getAllFlags(args.distinctId, {
      groups: args.groups,
      personProperties: args.personProperties,
      groupProperties: args.groupProperties,
      disableGeoip: args.disableGeoip,
      flagKeys: args.flagKeys,
    });
    await client.shutdown();
    return result;
  },
});

export const getAllFlagsAndPayloads = action({
  args: allFlagsArgs,
  handler: async (
    _ctx,
    args,
  ): Promise<{
    featureFlags?: Record<string, FeatureFlagValue>;
    featureFlagPayloads?: Record<string, JsonType>;
  }> => {
    const client = createClient(args.apiKey, args.host);
    const result = await client.getAllFlagsAndPayloads(args.distinctId, {
      groups: args.groups,
      personProperties: args.personProperties,
      groupProperties: args.groupProperties,
      disableGeoip: args.disableGeoip,
      flagKeys: args.flagKeys,
    });
    await client.shutdown();
    return result;
  },
});
