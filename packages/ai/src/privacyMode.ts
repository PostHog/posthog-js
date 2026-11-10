/** @internal */
export type PrivacyModeGate = {
  readonly privacyMode?: boolean
  /** Legacy spelling, still honored for callers that set it directly. */
  readonly privacy_mode?: boolean
  /** Read for posthog-node versions that predate the `privacyMode` accessor. */
  readonly options?: { readonly privacyMode?: boolean }
}

/** Per-call settings can turn redaction on but never off. */
export const isPrivacyModeEnabled = (client: PrivacyModeGate | undefined, privacyMode = false): boolean =>
  privacyMode === true ||
  client?.privacyMode === true ||
  client?.privacy_mode === true ||
  client?.options?.privacyMode === true
