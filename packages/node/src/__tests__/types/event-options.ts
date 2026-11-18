import type {
  CaptureExceptionOptions,
  EventMessage,
  EventOptions,
  GroupIdentifyMessage,
  IdentifyMessage,
  PostHog,
  PostHogOptions,
  PreparedEventMessage,
  SetPersonPropertiesMessage,
  UnsetPersonPropertiesMessage,
} from '../../entrypoints/index.node'

const options: EventOptions = {
  cookieless_mode: true,
  disable_skew_correction: false,
  process_person_profile: false,
  custom_option: { enabled: true, values: [1, 'value', null] },
  nullable_option: null,
}

export const capture: EventMessage = { event: 'event', options }
export const identify: IdentifyMessage = { distinctId: 'user', options }
export const group: GroupIdentifyMessage = { groupType: 'company', groupKey: 'company', options }
export const set: SetPersonPropertiesMessage = { distinctId: 'user', options }
export const unset: UnsetPersonPropertiesMessage = { distinctId: 'user', properties: 'name', options }
export const exception: CaptureExceptionOptions = { options }
export const context: Parameters<PostHog['withContext']>[0] = { options }
export const prepared: PreparedEventMessage = { distinctId: 'user', event: 'event', properties: {}, options }

export const config: PostHogOptions = {
  beforeSend: [(event) => event, () => null],
  customBlockedUserAgents: ['MyCustomBot'],
  disableCaptureUrlHashes: true,
  __previewCaptureBotPageviews: true,
}

export function checkEventOptions(posthog: PostHog): void {
  void posthog.registerOptions(options)
  void posthog.unregisterOptions('cookieless_mode')
  posthog.alias({ distinctId: 'user', alias: 'anonymous', options })
  void posthog.aliasImmediate({ distinctId: 'user', alias: 'anonymous', options })

  // @ts-expect-error Person processing takes a boolean, not an object.
  posthog.capture({ event: 'event', options: { process_person_profile: { enabled: false } } })
  // @ts-expect-error Cookieless mode takes a boolean.
  posthog.captureAi({ event: '$ai_generation', options: { cookieless_mode: 'true' } })
  // @ts-expect-error Skew correction takes a boolean.
  posthog.identify({ distinctId: 'user', options: { disable_skew_correction: 1 } })
  // @ts-expect-error Exception event options use the same boolean types.
  posthog.captureException(new Error('test'), { options: { process_person_profile: 'false' } })
  void posthog.registerOptions({ custom_option: { enabled: true } })
  void posthog.unregisterOptions('custom_option')
  // @ts-expect-error Additional options must contain JSON values.
  void posthog.registerOptions({ custom_option: () => true })
  // @ts-expect-error Additional capture options must contain JSON values.
  posthog.capture({ event: 'event', options: { custom_option: new Date() } })
  // @ts-expect-error Context options use the same narrow type.
  posthog.withContext({ options: { process_person_profile: [] } }, () => {})
  // @ts-expect-error Hook edits use the same narrow type.
  const invalidHook: PostHogOptions = { beforeSend: (event) => ({ ...event, options: { process_person_profile: [] } }) }
  void invalidHook

  // The 5.x configuration names are deprecated aliases until the next major.
  const oldHook: PostHogOptions = { before_send: () => null }
  const oldUserAgents: PostHogOptions = { custom_blocked_useragents: [] }
  const oldUrlHashes: PostHogOptions = { disable_capture_url_hashes: true }
  const oldBotPageviews: PostHogOptions = { __preview_capture_bot_pageviews: true }
  const invalidOldHook: PostHogOptions = {
    // @ts-expect-error The deprecated hook name uses the same narrow type as beforeSend.
    before_send: (event) => ({ ...event, options: { process_person_profile: [] } }),
  }
  void [oldHook, oldUserAgents, oldUrlHashes, oldBotPageviews, invalidOldHook]
}
