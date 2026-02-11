/// <reference types="vite/client" />
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { initConvexTest } from "./setup.test.js";
import { api } from "./_generated/api.js";

// Collect all fetch calls for assertion
let fetchCalls: Array<{ url: string; body: unknown }> = [];

function mockFetch(responseByUrl?: Record<string, unknown>) {
  fetchCalls = [];
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const urlStr = url.toString();
    let body: unknown;
    if (init?.body) {
      let rawText: string;
      if (init.body instanceof Blob) {
        const headers = init.headers as Record<string, string> | undefined;
        if (headers?.["Content-Encoding"] === "gzip") {
          const ds = new DecompressionStream("gzip");
          rawText = await new Response(
            init.body.stream().pipeThrough(ds),
          ).text();
        } else {
          rawText = await init.body.text();
        }
      } else {
        rawText = init.body as string;
      }
      try {
        body = JSON.parse(rawText);
      } catch {
        body = rawText;
      }
    }
    fetchCalls.push({ url: urlStr, body });

    if (responseByUrl) {
      for (const [pattern, response] of Object.entries(responseByUrl)) {
        if (urlStr.includes(pattern)) {
          return new Response(JSON.stringify(response), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
    }

    return new Response(JSON.stringify({ status: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function batchCalls() {
  return fetchCalls.filter((c) => c.url.includes("/batch"));
}

function flagsCalls() {
  return fetchCalls.filter((c) => c.url.includes("/flags"));
}

// Extract the first event from the first batch call
function firstBatchEvent(): Record<string, unknown> {
  const batches = batchCalls();
  const batch = batches[0]?.body as { batch: Record<string, unknown>[] };
  return batch?.batch?.[0] ?? {};
}

describe("capture", () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = "phc_test_key";
    process.env.POSTHOG_HOST = "https://test.posthog.com";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_HOST;
    fetchCalls = [];
  });

  test("sends event to PostHog API with correct distinct_id and event name", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    const result = await t.mutation(api.example.testCapture, {
      distinctId: "user-123",
      event: "button_clicked",
    });
    expect(result).toEqual({ success: true });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    expect(batchCalls().length).toBeGreaterThanOrEqual(1);
    const batch = batchCalls()[0].body as { api_key: string };
    expect(batch.api_key).toBe("phc_test_key");

    const event = firstBatchEvent();
    expect(event.distinct_id).toBe("user-123");
    expect(event.event).toBe("button_clicked");
  });

  test("sends properties and groups", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    await t.mutation(api.example.testCapture, {
      distinctId: "user-456",
      event: "purchase",
      properties: { plan: "pro", amount: 99 },
      groups: { company: "acme" },
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const event = firstBatchEvent();
    const props = event.properties as Record<string, unknown>;
    expect(props.plan).toBe("pro");
    expect(props.amount).toBe(99);
    expect(props.$groups).toEqual({ company: "acme" });
  });

  test("beforeSend enriches properties with environment", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    await t.mutation(api.example.testCapture, {
      distinctId: "user-123",
      event: "test",
      properties: { foo: "bar" },
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const props = firstBatchEvent().properties as Record<string, unknown>;
    expect(props.environment).toBe("example-app");
    expect(props.foo).toBe("bar");
  });

  test("sends disableGeoip flag", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    await t.mutation(api.example.testCapture, {
      distinctId: "user-123",
      event: "test",
      disableGeoip: true,
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const props = firstBatchEvent().properties as Record<string, unknown>;
    expect(props.$geoip_disable).toBe(true);
  });

  test("sends custom uuid", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    await t.mutation(api.example.testCapture, {
      distinctId: "user-123",
      event: "test",
      uuid: "custom-uuid-abc",
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const event = firstBatchEvent();
    expect(event.uuid).toBe("custom-uuid-abc");
  });

  test("sends timestamp", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    await t.mutation(api.example.testCapture, {
      distinctId: "user-123",
      event: "test",
      timestamp: "2024-06-15T12:00:00Z",
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const event = firstBatchEvent();
    expect(event.timestamp).toContain("2024-06-15");
  });
});

describe("identify", () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = "phc_test_key";
    process.env.POSTHOG_HOST = "https://test.posthog.com";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_HOST;
    fetchCalls = [];
  });

  test("sends $identify event", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    const result = await t.mutation(api.example.testIdentify, {
      distinctId: "user-123",
    });
    expect(result).toEqual({ success: true });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    expect(batchCalls().length).toBeGreaterThanOrEqual(1);
    const event = firstBatchEvent();
    expect(event.event).toBe("$identify");
    expect(event.distinct_id).toBe("user-123");
  });

  test("sends user properties", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    await t.mutation(api.example.testIdentify, {
      distinctId: "user-123",
      properties: {
        name: "Test User",
        email: "test@example.com",
      },
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const event = firstBatchEvent();
    // posthog-node puts properties into $set inside event.properties
    const props = event.properties as Record<string, unknown>;
    const $set = props.$set as Record<string, unknown>;
    expect($set.name).toBe("Test User");
    expect($set.email).toBe("test@example.com");
  });

  test("sends disableGeoip", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    await t.mutation(api.example.testIdentify, {
      distinctId: "user-123",
      disableGeoip: true,
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const props = firstBatchEvent().properties as Record<string, unknown>;
    expect(props.$geoip_disable).toBe(true);
  });
});

describe("groupIdentify", () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = "phc_test_key";
    process.env.POSTHOG_HOST = "https://test.posthog.com";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_HOST;
    fetchCalls = [];
  });

  test("sends $groupidentify event with group type and key", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    const result = await t.mutation(api.example.testGroupIdentify, {
      groupType: "company",
      groupKey: "acme",
    });
    expect(result).toEqual({ success: true });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    expect(batchCalls().length).toBeGreaterThanOrEqual(1);
    const event = firstBatchEvent();
    expect(event.event).toBe("$groupidentify");
    const props = event.properties as Record<string, unknown>;
    expect(props.$group_type).toBe("company");
    expect(props.$group_key).toBe("acme");
  });

  test("sends group properties via $group_set", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    await t.mutation(api.example.testGroupIdentify, {
      groupType: "company",
      groupKey: "acme",
      properties: { industry: "Technology", size: 100 },
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const props = firstBatchEvent().properties as Record<string, unknown>;
    const groupSet = props.$group_set as Record<string, unknown>;
    expect(groupSet.industry).toBe("Technology");
    expect(groupSet.size).toBe(100);
  });

  test("uses distinctId override when provided", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    await t.mutation(api.example.testGroupIdentify, {
      groupType: "company",
      groupKey: "acme",
      distinctId: "override-user",
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    expect(firstBatchEvent().distinct_id).toBe("override-user");
  });
});

describe("alias", () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = "phc_test_key";
    process.env.POSTHOG_HOST = "https://test.posthog.com";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_HOST;
    fetchCalls = [];
  });

  test("sends $create_alias event", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    const result = await t.mutation(api.example.testAlias, {
      distinctId: "user-123",
      alias: "anon-456",
    });
    expect(result).toEqual({ success: true });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    expect(batchCalls().length).toBeGreaterThanOrEqual(1);
    const event = firstBatchEvent();
    expect(event.event).toBe("$create_alias");
    const props = event.properties as Record<string, unknown>;
    expect(props.distinct_id).toBe("user-123");
    expect(props.alias).toBe("anon-456");
  });

  test("sends disableGeoip", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    await t.mutation(api.example.testAlias, {
      distinctId: "user-123",
      alias: "anon-456",
      disableGeoip: true,
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const props = firstBatchEvent().properties as Record<string, unknown>;
    expect(props.$geoip_disable).toBe(true);
  });
});

describe("captureException", () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = "phc_test_key";
    process.env.POSTHOG_HOST = "https://test.posthog.com";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_HOST;
    fetchCalls = [];
  });

  test("sends $exception event with Error object", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    const result = await t.mutation(api.example.testCaptureException, {
      errorMessage: "Something went wrong",
      errorType: "error",
    });
    expect(result).toEqual({ success: true });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    expect(batchCalls().length).toBeGreaterThanOrEqual(1);
    const event = firstBatchEvent();
    expect(event.event).toBe("$exception");
    const props = event.properties as Record<string, unknown>;
    // posthog-node v5 uses $exception_list instead of $exception_message
    const exceptionList = props.$exception_list as Array<{
      value: string;
      type: string;
    }>;
    expect(exceptionList[0].value).toBe("Something went wrong");
  });

  test("sends $exception event with string error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    await t.mutation(api.example.testCaptureException, {
      errorMessage: "string error",
      errorType: "string",
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const props = firstBatchEvent().properties as Record<string, unknown>;
    const exceptionList = props.$exception_list as Array<{
      value: string;
    }>;
    expect(exceptionList[0].value).toBe("string error");
  });

  test("sends $exception event with object error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    await t.mutation(api.example.testCaptureException, {
      errorMessage: "obj error",
      errorType: "object",
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const props = firstBatchEvent().properties as Record<string, unknown>;
    const exceptionList = props.$exception_list as Array<{
      value: string;
    }>;
    expect(exceptionList[0].value).toBe("obj error");
  });

  test("includes additional properties", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    await t.mutation(api.example.testCaptureException, {
      errorMessage: "test",
      additionalProperties: { page: "/checkout", step: 3 },
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const props = firstBatchEvent().properties as Record<string, unknown>;
    expect(props.page).toBe("/checkout");
    expect(props.step).toBe(3);
  });

  test("uses distinctId when provided", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch());
    const t = initConvexTest();

    await t.mutation(api.example.testCaptureException, {
      errorMessage: "test",
      distinctId: "specific-user",
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    expect(firstBatchEvent().distinct_id).toBe("specific-user");
  });
});

const flagsResponse = (
  flags: Record<string, unknown> = {},
  payloads: Record<string, unknown> = {},
) => ({
  "/flags": {
    featureFlags: flags,
    featureFlagPayloads: payloads,
  },
});

describe("getFeatureFlag", () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = "phc_test_key";
    process.env.POSTHOG_HOST = "https://test.posthog.com";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_HOST;
    fetchCalls = [];
  });

  test("returns flag value", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(flagsResponse({ "test-flag": "variant-a" })),
    );
    const t = initConvexTest();

    const result = await t.action(api.example.testGetFeatureFlag, {
      distinctId: "user-123",
      flagKey: "test-flag",
    });

    expect(result).toEqual({ flagKey: "test-flag", value: "variant-a" });
  });

  test("returns boolean flag", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(flagsResponse({ "bool-flag": true })),
    );
    const t = initConvexTest();

    const result = await t.action(api.example.testGetFeatureFlag, {
      distinctId: "user-123",
      flagKey: "bool-flag",
    });

    expect(result).toEqual({ flagKey: "bool-flag", value: true });
  });

  test("returns null for non-existent flag", async () => {
    vi.stubGlobal("fetch", mockFetch(flagsResponse()));
    const t = initConvexTest();

    const result = await t.action(api.example.testGetFeatureFlag, {
      distinctId: "user-123",
      flagKey: "missing",
    });

    expect(result).toEqual({ flagKey: "missing", value: null });
  });

  test("sends groups and person properties to /flags", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(flagsResponse({ "test-flag": true })),
    );
    const t = initConvexTest();

    await t.action(api.example.testGetFeatureFlag, {
      distinctId: "user-123",
      flagKey: "test-flag",
      groups: { company: "acme" },
      personProperties: { email: "test@example.com" },
      groupProperties: { company: { industry: "tech" } },
    });

    const calls = flagsCalls();
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const body = calls[0].body as Record<string, unknown>;
    expect(body.distinct_id).toBe("user-123");
    expect(body.groups).toEqual({ company: "acme" });
    expect(body.person_properties).toMatchObject({
      email: "test@example.com",
    });
    expect(body.group_properties).toMatchObject({
      company: { industry: "tech" },
    });
  });
});

describe("isFeatureEnabled", () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = "phc_test_key";
    process.env.POSTHOG_HOST = "https://test.posthog.com";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_HOST;
    fetchCalls = [];
  });

  test("returns true for enabled flag", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(flagsResponse({ "test-flag": true })),
    );
    const t = initConvexTest();

    const result = await t.action(api.example.testIsFeatureEnabled, {
      distinctId: "user-123",
      flagKey: "test-flag",
    });

    expect(result).toEqual({ flagKey: "test-flag", enabled: true });
  });

  test("returns true for string variant (truthy)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(flagsResponse({ "test-flag": "variant-a" })),
    );
    const t = initConvexTest();

    const result = await t.action(api.example.testIsFeatureEnabled, {
      distinctId: "user-123",
      flagKey: "test-flag",
    });

    expect(result).toEqual({ flagKey: "test-flag", enabled: true });
  });

  test("returns null for non-existent flag", async () => {
    vi.stubGlobal("fetch", mockFetch(flagsResponse()));
    const t = initConvexTest();

    const result = await t.action(api.example.testIsFeatureEnabled, {
      distinctId: "user-123",
      flagKey: "missing",
    });

    expect(result).toEqual({ flagKey: "missing", enabled: null });
  });
});

describe("getFeatureFlagPayload", () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = "phc_test_key";
    process.env.POSTHOG_HOST = "https://test.posthog.com";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_HOST;
    fetchCalls = [];
  });

  test("returns payload for flag", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        flagsResponse({ "test-flag": true }, { "test-flag": { key: "value" } }),
      ),
    );
    const t = initConvexTest();

    const result = await t.action(api.example.testGetFeatureFlagPayload, {
      distinctId: "user-123",
      flagKey: "test-flag",
    });

    expect(result).toEqual({
      flagKey: "test-flag",
      payload: { key: "value" },
    });
  });

  test("returns null when no payload exists", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(flagsResponse({ "test-flag": true })),
    );
    const t = initConvexTest();

    const result = await t.action(api.example.testGetFeatureFlagPayload, {
      distinctId: "user-123",
      flagKey: "test-flag",
    });

    expect(result).toEqual({ flagKey: "test-flag", payload: null });
  });

  test("accepts matchValue parameter", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        flagsResponse(
          { "test-flag": "variant-a" },
          { "test-flag": "payload-data" },
        ),
      ),
    );
    const t = initConvexTest();

    const result = await t.action(api.example.testGetFeatureFlagPayload, {
      distinctId: "user-123",
      flagKey: "test-flag",
      matchValue: "variant-a",
    });

    expect(result.flagKey).toBe("test-flag");
    expect(result.payload).toBe("payload-data");
  });
});

describe("getFeatureFlagResult", () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = "phc_test_key";
    process.env.POSTHOG_HOST = "https://test.posthog.com";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_HOST;
    fetchCalls = [];
  });

  test("returns full result with variant and payload", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        flagsResponse(
          { "test-flag": "variant-a" },
          { "test-flag": { config: true } },
        ),
      ),
    );
    const t = initConvexTest();

    const result = await t.action(api.example.testGetFeatureFlagResult, {
      distinctId: "user-123",
      flagKey: "test-flag",
    });

    expect(result.flagKey).toBe("test-flag");
    expect(result.result).not.toBeNull();
    expect(result.result!.key).toBe("test-flag");
    expect(result.result!.enabled).toBe(true);
    expect(result.result!.variant).toBe("variant-a");
    expect(result.result!.payload).toEqual({ config: true });
  });

  test("returns null for non-existent flag", async () => {
    vi.stubGlobal("fetch", mockFetch(flagsResponse()));
    const t = initConvexTest();

    const result = await t.action(api.example.testGetFeatureFlagResult, {
      distinctId: "user-123",
      flagKey: "missing",
    });

    expect(result).toEqual({ flagKey: "missing", result: null });
  });
});

describe("getAllFlags", () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = "phc_test_key";
    process.env.POSTHOG_HOST = "https://test.posthog.com";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_HOST;
    fetchCalls = [];
  });

  test("returns all flags", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        flagsResponse({
          "flag-a": true,
          "flag-b": "variant-1",
          "flag-c": false,
        }),
      ),
    );
    const t = initConvexTest();

    const result = await t.action(api.example.testGetAllFlags, {
      distinctId: "user-123",
    });

    expect(result.flags).toEqual({
      "flag-a": true,
      "flag-b": "variant-1",
      "flag-c": false,
    });
  });

  test("sends groups and properties to /flags", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(flagsResponse({ "test-flag": true })),
    );
    const t = initConvexTest();

    await t.action(api.example.testGetAllFlags, {
      distinctId: "user-123",
      groups: { company: "acme" },
      personProperties: { plan: "pro" },
      groupProperties: { company: { size: "100" } },
    });

    const body = flagsCalls()[0].body as Record<string, unknown>;
    expect(body.groups).toEqual({ company: "acme" });
    expect(body.person_properties).toMatchObject({ plan: "pro" });
    expect(body.group_properties).toMatchObject({ company: { size: "100" } });
  });

  test("accepts flagKeys filter", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(flagsResponse({ "flag-a": true })),
    );
    const t = initConvexTest();

    const result = await t.action(api.example.testGetAllFlags, {
      distinctId: "user-123",
      flagKeys: ["flag-a", "flag-b"],
    });

    expect(result.flags).toBeDefined();
  });
});

describe("getAllFlagsAndPayloads", () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = "phc_test_key";
    process.env.POSTHOG_HOST = "https://test.posthog.com";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_HOST;
    fetchCalls = [];
  });

  test("returns flags and payloads", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        flagsResponse(
          { "flag-a": true, "flag-b": "variant" },
          { "flag-a": { config: "value" } },
        ),
      ),
    );
    const t = initConvexTest();

    const result = await t.action(api.example.testGetAllFlagsAndPayloads, {
      distinctId: "user-123",
    });

    expect(result.featureFlags).toEqual({
      "flag-a": true,
      "flag-b": "variant",
    });
    expect(result.featureFlagPayloads).toEqual({
      "flag-a": { config: "value" },
    });
  });

  test("accepts flagKeys filter", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        flagsResponse({ "flag-a": true }, { "flag-a": "payload" }),
      ),
    );
    const t = initConvexTest();

    const result = await t.action(api.example.testGetAllFlagsAndPayloads, {
      distinctId: "user-123",
      flagKeys: ["flag-a"],
    });

    expect(result.featureFlags).toBeDefined();
    expect(result.featureFlagPayloads).toBeDefined();
  });
});
