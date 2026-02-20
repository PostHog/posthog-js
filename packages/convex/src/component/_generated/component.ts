/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    lib: {
      alias: FunctionReference<
        "action",
        "internal",
        {
          alias: string;
          apiKey: string;
          disableGeoip?: boolean;
          distinctId: string;
          host: string;
        },
        any,
        Name
      >;
      capture: FunctionReference<
        "action",
        "internal",
        {
          apiKey: string;
          disableGeoip?: boolean;
          distinctId: string;
          event: string;
          groups?: any;
          host: string;
          properties?: any;
          sendFeatureFlags?: boolean;
          timestamp?: number;
          uuid?: string;
        },
        any,
        Name
      >;
      captureException: FunctionReference<
        "action",
        "internal",
        {
          additionalProperties?: any;
          apiKey: string;
          distinctId?: string;
          errorMessage: string;
          errorName?: string;
          errorStack?: string;
          host: string;
        },
        any,
        Name
      >;
      getAllFlags: FunctionReference<
        "action",
        "internal",
        {
          apiKey: string;
          disableGeoip?: boolean;
          distinctId: string;
          flagKeys?: Array<string>;
          groupProperties?: any;
          groups?: any;
          host: string;
          personProperties?: any;
        },
        any,
        Name
      >;
      getAllFlagsAndPayloads: FunctionReference<
        "action",
        "internal",
        {
          apiKey: string;
          disableGeoip?: boolean;
          distinctId: string;
          flagKeys?: Array<string>;
          groupProperties?: any;
          groups?: any;
          host: string;
          personProperties?: any;
        },
        any,
        Name
      >;
      getFeatureFlag: FunctionReference<
        "action",
        "internal",
        {
          apiKey: string;
          disableGeoip?: boolean;
          distinctId: string;
          groupProperties?: any;
          groups?: any;
          host: string;
          key: string;
          personProperties?: any;
          sendFeatureFlagEvents?: boolean;
        },
        any,
        Name
      >;
      getFeatureFlagPayload: FunctionReference<
        "action",
        "internal",
        {
          apiKey: string;
          disableGeoip?: boolean;
          distinctId: string;
          groupProperties?: any;
          groups?: any;
          host: string;
          key: string;
          matchValue?: string | boolean;
          personProperties?: any;
          sendFeatureFlagEvents?: boolean;
        },
        any,
        Name
      >;
      getFeatureFlagResult: FunctionReference<
        "action",
        "internal",
        {
          apiKey: string;
          disableGeoip?: boolean;
          distinctId: string;
          groupProperties?: any;
          groups?: any;
          host: string;
          key: string;
          personProperties?: any;
          sendFeatureFlagEvents?: boolean;
        },
        any,
        Name
      >;
      groupIdentify: FunctionReference<
        "action",
        "internal",
        {
          apiKey: string;
          disableGeoip?: boolean;
          distinctId?: string;
          groupKey: string;
          groupType: string;
          host: string;
          properties?: any;
        },
        any,
        Name
      >;
      identify: FunctionReference<
        "action",
        "internal",
        {
          apiKey: string;
          disableGeoip?: boolean;
          distinctId: string;
          host: string;
          properties?: any;
        },
        any,
        Name
      >;
      isFeatureEnabled: FunctionReference<
        "action",
        "internal",
        {
          apiKey: string;
          disableGeoip?: boolean;
          distinctId: string;
          groupProperties?: any;
          groups?: any;
          host: string;
          key: string;
          personProperties?: any;
          sendFeatureFlagEvents?: boolean;
        },
        any,
        Name
      >;
    };
  };
