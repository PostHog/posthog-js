/**
 * Read the release id embedded at build time or injected into a processed bundle.
 *
 * Framework integrations can compile `POSTHOG_RELEASE_ID` into browser code before asset hashes
 * are finalized. The global remains as a fallback for bundles processed by posthog-cli.
 */
export function getInjectedReleaseId(): string | undefined {
  if (typeof process !== 'undefined') {
    const fromEnvironment = process.env.POSTHOG_RELEASE_ID?.trim()
    if (fromEnvironment) {
      return fromEnvironment
    }
  }

  const injected = (globalThis as any)._posthogReleaseId
  return typeof injected === 'string' && injected.length > 0 ? injected : undefined
}
