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
          disableGeoip?: boolean;
          distinctId: string;
        },
        any,
        Name
      >;
      capture: FunctionReference<
        "action",
        "internal",
        {
          disableGeoip?: boolean;
          distinctId: string;
          event: string;
          groups?: string;
          properties?: string;
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
          additionalProperties?: string;
          distinctId?: string;
          errorMessage: string;
          errorName?: string;
          errorStack?: string;
        },
        any,
        Name
      >;
      evaluateAllFlags: FunctionReference<
        "action",
        "internal",
        {
          disableGeoip?: boolean;
          distinctId: string;
          flagKeys?: Array<string>;
          groupProperties?: any;
          groups?: any;
          personProperties?: any;
        },
        any,
        Name
      >;
      evaluateFlag: FunctionReference<
        "action",
        "internal",
        {
          disableGeoip?: boolean;
          distinctId: string;
          flagKeys?: Array<string>;
          groupProperties?: any;
          groups?: any;
          key: string;
          personProperties?: any;
        },
        any,
        Name
      >;
      evaluateFlagPayload: FunctionReference<
        "action",
        "internal",
        {
          disableGeoip?: boolean;
          distinctId: string;
          flagKeys?: Array<string>;
          groupProperties?: any;
          groups?: any;
          key: string;
          personProperties?: any;
        },
        any,
        Name
      >;
      getFlagDefinitions: FunctionReference<"query", "internal", {}, any, Name>;
      groupIdentify: FunctionReference<
        "action",
        "internal",
        {
          disableGeoip?: boolean;
          distinctId?: string;
          groupKey: string;
          groupType: string;
          properties?: string;
        },
        any,
        Name
      >;
      identify: FunctionReference<
        "action",
        "internal",
        {
          disableGeoip?: boolean;
          distinctId: string;
          properties?: string;
        },
        any,
        Name
      >;
      refreshFlagDefinitions: FunctionReference<
        "action",
        "internal",
        {},
        any,
        Name
      >;
    };
  };
