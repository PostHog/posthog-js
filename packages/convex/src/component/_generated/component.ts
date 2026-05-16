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
          groups?: string;
          host: string;
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
      getFlagDefinitions: FunctionReference<"query", "internal", {}, any, Name>;
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
          properties?: string;
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
          properties?: string;
        },
        any,
        Name
      >;
    };
  };
