# Investigation: Web Analytics Filter URL Loop

## Reported Symptom

> When using PostHog with filters applied, the URL constantly changes. The browser consumes excessive resources, making PostHog unusable. The URL sometimes contains `[object Object]&date=...`.

## Root Cause Analysis

The issue originates in the **PostHog main application** (`PostHog/posthog` repo), specifically in `frontend/src/scenes/web-analytics/webAnalyticsLogic.tsx`. It is **not** a posthog-js SDK bug.

There are **two interrelated bugs** that combine to produce the described behavior:

---

### Bug 1: Infinite Loop in `urlToAction` ↔ `actionToUrl` Cycle

**The Mechanism (Kea + kea-router):**

PostHog's frontend uses [Kea](https://keajs.org/) for state management with the `kea-router` plugin to sync state ↔ URL. The pattern is:

1. User changes a filter → `actionToUrl` fires → URL updates
2. URL change → `urlToAction` fires → dispatches state actions
3. State updates → `actionToUrl` fires → URL updates again
4. **Repeat → infinite loop**

**The Original Fix (Oct 2024):** [PR #25465](https://github.com/PostHog/posthog/pull/25465) by @raquelmsmith

Added `objectsEqual` checks to prevent redundant dispatches:

```typescript
// BEFORE (loops infinitely):
if (parsedFilters) {
    actions.setWebAnalyticsFilters(parsedFilters)
}

// AFTER (only dispatches when values actually changed):
if (parsedFilters && !objectsEqual(parsedFilters, values.webAnalyticsFilters)) {
    actions.setWebAnalyticsFilters(parsedFilters)
}
```

**The Regression (introduced ~Feb 2025, fixed Feb 10, 2026):**

When domain/device type filtering was added in [PR #29256](https://github.com/PostHog/posthog/pull/29256) (Feb 27, 2025), a new `webAnalyticsFilters` **derived selector** was introduced that combines `rawWebAnalyticsFilters` with domain/device filters. The `urlToAction` equality check was comparing against the **derived** selector instead of the **raw** stored state:

```typescript
// BUG: Compares URL params against derived selector (includes domain/device filters)
// The parsed URL filters will NEVER equal the derived filters → always dispatches → loop
if (parsedFilters && !objectsEqual(parsedFilters, values.webAnalyticsFilters)) {
    actions.setWebAnalyticsFilters(parsedFilters)
}
```

This was fixed in [PR #47369](https://github.com/PostHog/posthog/pull/47369) (Feb 10, 2026) by @lricoy:

```typescript
// FIX: Compare against raw stored state, not derived selector
if (parsedFilters && !objectsEqual(parsedFilters, values.rawWebAnalyticsFilters)) {
    actions.setWebAnalyticsFilters(parsedFilters)
}
```

---

### Bug 2: `[object Object]` in URL Query String

**The Mechanism:**

`kea-router` auto-parses URL search parameters. For example:
- `?compare_filter={"compare":true}` → `searchParams = { compare_filter: { compare: true } }`

In `webAnalyticsLogic.tsx`, the `actionToUrl` handler rebuilds URL params like:

```typescript
const searchParams = { ...router.values.searchParams }  // spreads parsed objects!
const urlParams = new URLSearchParams(searchParams)       // calls .toString() on values!
```

`URLSearchParams` calls `.toString()` on every value. For objects, `{}.toString()` returns `"[object Object]"`. So any auto-parsed object from `router.values.searchParams` that isn't explicitly overwritten by a subsequent `urlParams.set('key', JSON.stringify(value))` call ends up as `[object Object]` in the URL.

During the infinite loop, the rapid URL rewrites compound this:
1. First iteration: `?filters=[{...}]&date_from=-7d` (correct)
2. `urlToAction` parses this → `searchParams.filters` becomes an array of objects
3. `actionToUrl` spreads `searchParams` → `new URLSearchParams({ filters: [{...}] })` → `filters=[object Object]`
4. The code _should_ overwrite with `JSON.stringify`, but during the loop, timing/state issues may cause some iterations to not properly overwrite all keys

---

### Bug 3 (Bonus): Crash on Invalid URLs with Domain Filter

Also fixed in [PR #47369](https://github.com/PostHog/posthog/pull/47369): when applying "Current URL (contains)" filter with a domain filter, `sanitizePossibleWildCardedURL()` in `authorizedUrlListLogic.ts` could crash with `TypeError: Failed to construct 'URL': Invalid URL` when encountering malformed `$current_url` values from the database. Fixed by adding try-catch.

---

## Timeline of Relevant PRs

| Date | PR | Description |
|------|------|-------------|
| Oct 9, 2024 | [#25465](https://github.com/PostHog/posthog/pull/25465) | **Original fix**: infinite loop on filter change |
| Feb 27, 2025 | [#29256](https://github.com/PostHog/posthog/pull/29256) | **Regression introduced**: domain/device dropdown + filters UI revamp |
| Jan 22, 2026 | [#45518](https://github.com/PostHog/posthog/pull/45518) | Make date and interval filters independent |
| Feb 10, 2026 | [#47369](https://github.com/PostHog/posthog/pull/47369) | **Fix regression**: correct comparison to use rawWebAnalyticsFilters |
| Feb 12, 2026 | [#46220](https://github.com/PostHog/posthog/pull/46220) | Add cohort filter support to web analytics |

## Impact on posthog-js

The posthog-js SDK is **not the cause** of this issue. However, posthog-js does patch `window.history.pushState` and `replaceState` for autocapture (in `history-autocapture.ts`), and the surveys extension patches these again (in `surveys.tsx`). While these patches don't cause the loop, they could slightly amplify the performance impact since every URL change during the loop triggers additional event processing in posthog-js.

## Recommendation

1. If users are on a PostHog version **before Feb 10, 2026** and using web analytics with domain filters, they will experience this loop. Upgrading to the latest version (which includes PR #47369) should resolve it.

2. For the `[object Object]` aspect: A more robust fix would be to sanitize `router.values.searchParams` values before spreading into `URLSearchParams`, or avoid using `URLSearchParams` constructor with the spread altogether and instead build params explicitly with `JSON.stringify` for all complex values.

3. The `urlToAction`/`actionToUrl` pattern in Kea is inherently prone to loops if equality checks are not maintained carefully. Any future changes to `webAnalyticsLogic.tsx` that add or modify filters should include equality guards against the correct (raw, non-derived) state.
