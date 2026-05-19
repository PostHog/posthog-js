// Shared header fixtures for network-wrapper invariant tests.
// One place to update when a new sensitive header is reported.
// Imported by:
//   - fetch-wrapper-invariants.test.ts
//   - xhr-wrapper-invariants.test.ts
//   - playwright/mocked/session-recording/csrf-headers-preserved.spec.ts

// Headers PostHog redacts from the recording via HEADER_DENY_LIST
// in src/extensions/replay/external/config.ts. The invariant: the
// wrapper must redact them in the recording but NEVER strip them
// from the actual outgoing request to the server.
export const sensitiveHeaderCases = [
    ['x-csrf-token', 'r_lIDFH3NdoomvNNKK5SWHg3KFOpWvnARWDvvi_TbwY'],
    ['x-csrftoken', 'django-style-csrf'],
    ['x-xsrf-token', 'angular-style-xsrf'],
    ['authorization', 'Bearer abc123'],
    ['x-api-key', 'sk-test-1234'],
] as const

// CSRF subset, for double-wrap tests and the playwright cross-browser
// sweep where the full sensitive set adds little extra coverage.
export const csrfHeaderCases = [
    ['x-csrf-token', 'r_lIDFH3NdoomvNNKK5SWHg3KFOpWvnARWDvvi_TbwY'],
    ['x-csrftoken', 'django-style-csrf'],
    ['x-xsrf-token', 'angular-style-xsrf'],
] as const

// Ordinary (non-deny-listed) headers. Asserted to also pass through
// unchanged — but NOT load-bearing for the deny-list bug being guarded.
export const unaffectedHeaderCases = [
    ['cache-control', 'no-cache'],
    ['pragma', 'no-cache'],
] as const
