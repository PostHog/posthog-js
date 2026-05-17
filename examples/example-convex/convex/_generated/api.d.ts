/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiSdk_manualCapture from "../aiSdk/manualCapture.js";
import type * as aiSdk_openTelemetry from "../aiSdk/openTelemetry.js";
import type * as aiSdk_withTracing from "../aiSdk/withTracing.js";
import type * as convexAgent_manualCapture from "../convexAgent/manualCapture.js";
import type * as convexAgent_openTelemetry from "../convexAgent/openTelemetry.js";
import type * as convexAgent_withTracing from "../convexAgent/withTracing.js";
import type * as crons from "../crons.js";
import type * as example from "../example.js";
import type * as posthog from "../posthog.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "aiSdk/manualCapture": typeof aiSdk_manualCapture;
  "aiSdk/openTelemetry": typeof aiSdk_openTelemetry;
  "aiSdk/withTracing": typeof aiSdk_withTracing;
  "convexAgent/manualCapture": typeof convexAgent_manualCapture;
  "convexAgent/openTelemetry": typeof convexAgent_openTelemetry;
  "convexAgent/withTracing": typeof convexAgent_withTracing;
  crons: typeof crons;
  example: typeof example;
  posthog: typeof posthog;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  posthog: import("@posthog/convex/_generated/component.js").ComponentApi<"posthog">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
