import { defineApp } from 'convex/server'
import { v } from 'convex/values'
import { describe, expect, test } from 'vitest'
import posthog from './convex.config.js'

// Compile-time contract: Convex's `app.use` requires bundler-injected `componentDefinitionPath`
// at runtime, so we verify the env-var type bindings statically via `tsc` (`pnpm typecheck`).
function _assertAppEnvBindingsTypecheck(): void {
  const optionalApp = defineApp({
    env: {
      POSTHOG_PROJECT_TOKEN: v.optional(v.string()),
    },
  })
  optionalApp.use(posthog, {
    env: {
      POSTHOG_PROJECT_TOKEN: optionalApp.env.POSTHOG_PROJECT_TOKEN,
    },
  })

  const requiredApp = defineApp({
    env: {
      POSTHOG_PROJECT_TOKEN: v.string(),
    },
  })
  requiredApp.use(posthog, {
    env: {
      POSTHOG_PROJECT_TOKEN: requiredApp.env.POSTHOG_PROJECT_TOKEN,
    },
  })

  // Both `{ env: {} }` and `{ env: { POSTHOG_PROJECT_TOKEN: undefined } }` fail `tsc` if
  // `POSTHOG_PROJECT_TOKEN` is ever reverted to `v.string()`.
  const omitEnvApp = defineApp()
  omitEnvApp.use(posthog)
  omitEnvApp.use(posthog, { env: {} })
  omitEnvApp.use(posthog, { env: { POSTHOG_PROJECT_TOKEN: undefined } })
}

describe('component convex.config', () => {
  test('declares POSTHOG_PROJECT_TOKEN as optional in exported component definition', () => {
    const exported = (
      posthog as unknown as {
        export: () => { envVars: Array<[string, { type: string; value: string; optional: boolean }]> }
      }
    ).export()
    const envByName = new Map(exported.envVars)
    expect(envByName.get('POSTHOG_PROJECT_TOKEN')).toEqual({
      type: 'value',
      value: JSON.stringify({ type: 'string' }),
      optional: true,
    })
    expect(typeof _assertAppEnvBindingsTypecheck).toBe('function')
  })
})
