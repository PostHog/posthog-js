import type { Scheduler } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";

/** Context with a scheduler — available in mutations and actions. */
type SchedulerCtx = { scheduler: Scheduler };

/** Context with runAction — available in actions only. */
type ActionCtx = { runAction: (reference: any, args: any) => Promise<any> };

type FeatureFlagOptions = {
  groups?: Record<string, string>;
  personProperties?: Record<string, string>;
  groupProperties?: Record<string, Record<string, string>>;
  sendFeatureFlagEvents?: boolean;
  disableGeoip?: boolean;
};

export type FeatureFlagResult = {
  key: string;
  enabled: boolean;
  variant: string | null;
  payload: unknown;
};

export type PostHogEvent = {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
};

export type BeforeSendFn = (event: PostHogEvent) => PostHogEvent | null;

export type IdentifyFn = (
  ctx: any,
) => Promise<{ distinctId: string } | null>;

export function normalizeError(error: unknown): {
  message: string;
  stack?: string;
  name?: string;
} {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack, name: error.name };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    const obj = error as {
      message: string;
      stack?: unknown;
      name?: unknown;
    };
    return {
      message: obj.message,
      stack: typeof obj.stack === "string" ? obj.stack : undefined,
      name: typeof obj.name === "string" ? obj.name : undefined,
    };
  }
  return { message: String(error) };
}

export class PostHog {
  private apiKey: string;
  private host: string;
  private beforeSend?: BeforeSendFn | BeforeSendFn[];
  private identifyFn?: IdentifyFn;

  constructor(
    public component: ComponentApi,
    options?: {
      apiKey?: string;
      host?: string;
      beforeSend?: BeforeSendFn | BeforeSendFn[];
      identify?: IdentifyFn;
    },
  ) {
    this.apiKey = options?.apiKey ?? process.env.POSTHOG_API_KEY ?? "";
    this.host =
      options?.host ?? process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";
    this.beforeSend = options?.beforeSend;
    this.identifyFn = options?.identify;
  }

  private async resolveDistinctId(
    ctx: unknown,
    argsDistinctId?: string,
  ): Promise<string> {
    if (this.identifyFn) {
      const result = await this.identifyFn(ctx);
      if (result) return result.distinctId;
    }
    if (argsDistinctId) return argsDistinctId;
    throw new Error(
      "PostHog: Could not resolve distinctId. Either configure an identify callback " +
        "in the PostHog constructor or pass distinctId explicitly.",
    );
  }

  private runBeforeSend(event: PostHogEvent): PostHogEvent | null {
    if (!this.beforeSend) return event;
    const fns = Array.isArray(this.beforeSend)
      ? this.beforeSend
      : [this.beforeSend];
    let result: PostHogEvent | null = event;
    for (const fn of fns) {
      result = fn(result);
      if (!result) return null;
    }
    return result;
  }

  // --- Fire-and-forget methods (work in mutations and actions) ---

  async capture(
    ctx: SchedulerCtx,
    args: {
      distinctId?: string;
      event: string;
      properties?: Record<string, unknown>;
      groups?: Record<string, string | number>;
      sendFeatureFlags?: boolean;
      timestamp?: Date;
      uuid?: string;
      disableGeoip?: boolean;
    },
  ) {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId);
    const result = this.runBeforeSend({
      event: args.event,
      distinctId,
      properties: args.properties,
    });
    if (!result) return;

    await ctx.scheduler.runAfter(0, this.component.lib.capture, {
      apiKey: this.apiKey,
      host: this.host,
      distinctId: result.distinctId,
      event: result.event,
      properties: result.properties,
      groups: args.groups,
      sendFeatureFlags: args.sendFeatureFlags,
      timestamp: args.timestamp?.getTime(),
      uuid: args.uuid,
      disableGeoip: args.disableGeoip,
    });
  }

  async identify(
    ctx: SchedulerCtx,
    args: {
      distinctId?: string;
      properties?: Record<string, unknown> & {
        $set?: Record<string, unknown>;
        $set_once?: Record<string, unknown>;
        $anon_distinct_id?: string;
      };
      disableGeoip?: boolean;
    },
  ) {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId);
    const result = this.runBeforeSend({
      event: "$identify",
      distinctId,
      properties: args.properties,
    });
    if (!result) return;

    await ctx.scheduler.runAfter(0, this.component.lib.identify, {
      apiKey: this.apiKey,
      host: this.host,
      distinctId: result.distinctId,
      properties: result.properties,
      disableGeoip: args.disableGeoip,
    });
  }

  async groupIdentify(
    ctx: SchedulerCtx,
    args: {
      groupType: string;
      groupKey: string;
      properties?: Record<string, unknown>;
      distinctId?: string;
      disableGeoip?: boolean;
    },
  ) {
    const result = this.runBeforeSend({
      event: "$groupidentify",
      distinctId: args.distinctId ?? "",
      properties: args.properties,
    });
    if (!result) return;

    await ctx.scheduler.runAfter(0, this.component.lib.groupIdentify, {
      apiKey: this.apiKey,
      host: this.host,
      groupType: args.groupType,
      groupKey: args.groupKey,
      properties: result.properties,
      distinctId: args.distinctId,
      disableGeoip: args.disableGeoip,
    });
  }

  async alias(
    ctx: SchedulerCtx,
    args: {
      distinctId?: string;
      alias: string;
      disableGeoip?: boolean;
    },
  ) {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId);
    const result = this.runBeforeSend({
      event: "$create_alias",
      distinctId,
    });
    if (!result) return;

    await ctx.scheduler.runAfter(0, this.component.lib.alias, {
      apiKey: this.apiKey,
      host: this.host,
      distinctId: result.distinctId,
      alias: args.alias,
      disableGeoip: args.disableGeoip,
    });
  }

  async captureException(
    ctx: SchedulerCtx,
    args: {
      error: unknown;
      distinctId?: string;
      additionalProperties?: Record<string, unknown>;
    },
  ) {
    const { message, stack, name } = normalizeError(args.error);

    let distinctId: string | undefined;
    try {
      distinctId = await this.resolveDistinctId(ctx, args.distinctId);
    } catch {
      // captureException works without a distinctId
    }

    const result = this.runBeforeSend({
      event: "$exception",
      distinctId: distinctId ?? "",
      properties: args.additionalProperties,
    });
    if (!result) return;

    await ctx.scheduler.runAfter(0, this.component.lib.captureException, {
      apiKey: this.apiKey,
      host: this.host,
      distinctId: result.distinctId || undefined,
      errorMessage: message,
      errorStack: stack,
      errorName: name,
      additionalProperties: result.properties,
    });
  }

  // --- Feature flag methods (require action context) ---

  async getFeatureFlag(
    ctx: ActionCtx,
    args: { key: string; distinctId?: string } & FeatureFlagOptions,
  ): Promise<boolean | string | null> {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId);
    return await ctx.runAction(this.component.lib.getFeatureFlag, {
      apiKey: this.apiKey,
      host: this.host,
      ...args,
      distinctId,
    });
  }

  async isFeatureEnabled(
    ctx: ActionCtx,
    args: { key: string; distinctId?: string } & FeatureFlagOptions,
  ): Promise<boolean | null> {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId);
    return await ctx.runAction(this.component.lib.isFeatureEnabled, {
      apiKey: this.apiKey,
      host: this.host,
      ...args,
      distinctId,
    });
  }

  async getFeatureFlagPayload(
    ctx: ActionCtx,
    args: {
      key: string;
      distinctId?: string;
      matchValue?: boolean | string;
    } & FeatureFlagOptions,
  ): Promise<unknown> {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId);
    return await ctx.runAction(this.component.lib.getFeatureFlagPayload, {
      apiKey: this.apiKey,
      host: this.host,
      ...args,
      distinctId,
    });
  }

  async getFeatureFlagResult(
    ctx: ActionCtx,
    args: { key: string; distinctId?: string } & FeatureFlagOptions,
  ): Promise<FeatureFlagResult | null> {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId);
    return await ctx.runAction(this.component.lib.getFeatureFlagResult, {
      apiKey: this.apiKey,
      host: this.host,
      ...args,
      distinctId,
    });
  }

  async getAllFlags(
    ctx: ActionCtx,
    args: {
      distinctId?: string;
      groups?: Record<string, string>;
      personProperties?: Record<string, string>;
      groupProperties?: Record<string, Record<string, string>>;
      disableGeoip?: boolean;
      flagKeys?: string[];
    },
  ): Promise<Record<string, boolean | string>> {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId);
    return await ctx.runAction(this.component.lib.getAllFlags, {
      apiKey: this.apiKey,
      host: this.host,
      ...args,
      distinctId,
    });
  }

  async getAllFlagsAndPayloads(
    ctx: ActionCtx,
    args: {
      distinctId?: string;
      groups?: Record<string, string>;
      personProperties?: Record<string, string>;
      groupProperties?: Record<string, Record<string, string>>;
      disableGeoip?: boolean;
      flagKeys?: string[];
    },
  ): Promise<{
    featureFlags: Record<string, boolean | string>;
    featureFlagPayloads: Record<string, unknown>;
  }> {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId);
    return await ctx.runAction(this.component.lib.getAllFlagsAndPayloads, {
      apiKey: this.apiKey,
      host: this.host,
      ...args,
      distinctId,
    });
  }
}
