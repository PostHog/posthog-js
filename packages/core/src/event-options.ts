/**
 * Each per-event option, mapped to the event property that carries it when the client has no
 * per-event options, as in posthog-node 5.
 */
export const EVENT_OPTION_LEGACY_PROPERTIES = {
  process_person_profile: '$process_person_profile',
  cookieless_mode: '$cookieless_mode',
  disable_skew_correction: '$ignore_sent_at',
  product_tour_id: '$product_tour_id',
} as const

/**
 * The event properties that carry `options` for a client without per-event options. A `null` or
 * `undefined` value is unset, so it gets no property; an unknown key is dropped.
 */
export function eventOptionsAsLegacyProperties(
  options: Readonly<Record<string, unknown>> | undefined
): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(options ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(EVENT_OPTION_LEGACY_PROPERTIES, key)) {
      continue
    }
    if (value !== undefined && value !== null) {
      properties[EVENT_OPTION_LEGACY_PROPERTIES[key as keyof typeof EVENT_OPTION_LEGACY_PROPERTIES]] = value
    }
  }
  return properties
}

/**
 * Whether a posthog-node client takes per-event options. `registerOptions` first shipped with them
 * in posthog-node 6.0. The version is not read, because a subclass or wrapper can override
 * `getLibraryVersion()`.
 */
export function acceptsEventOptions(client: { readonly registerOptions?: unknown }): boolean {
  return typeof client.registerOptions === 'function'
}
