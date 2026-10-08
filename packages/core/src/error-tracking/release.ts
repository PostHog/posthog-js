/**
 * Read the release id injected into the bundle by posthog-cli.
 *
 * The CLI prepends a small IIFE to each chunk that sets `globalThis._posthogReleaseId` to the
 * release row's id (a string, first write wins so the first loaded chunk pins the release for the
 * runtime). The SDK emits it on `$exception` events so the server resolves the release with a plain
 * foreign-key lookup. Returns `undefined` when nothing was injected or the value is malformed.
 */
export function getInjectedReleaseId(): string | undefined {
  const injected = (globalThis as any)._posthogReleaseId
  return typeof injected === 'string' && injected.length > 0 ? injected : undefined
}
