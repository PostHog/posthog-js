import { action, env, query } from './_generated/server.js'

export {
  alias,
  capture,
  captureException,
  evaluateAllFlags,
  evaluateFlag,
  evaluateFlagPayload,
  groupIdentify,
  identify,
} from '../component/lib.js'

// The two functions below keep the same names and shapes as the default component's local-evaluation
// functions, so the client's `PostHog` class accepts either component. They never touch a table and
// never schedule work.

// `eventsOnly` lets the client's local-eval methods throw an error that points at the remote
// `evaluateFlag*` methods instead of failing with a missing-function error.
export const getFlagDefinitions = query({
  args: {},
  handler: async () => {
    return {
      disabled: !(env.POSTHOG_PROJECT_TOKEN ?? '').trim(),
      localEvalConfigured: false,
      eventsOnly: true,
      data: null,
      fetchedAt: null,
    }
  },
})

export const refreshFlagDefinitions = action({
  args: {},
  handler: async () => {
    return { status: 'skipped' as const, reason: 'events-only' as const }
  },
})
