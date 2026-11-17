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

  // @ts-expect-error Configuration names use camelCase in Node 6.
  const oldHook: PostHogOptions = { before_send: () => null }
  // @ts-expect-error Configuration names use camelCase in Node 6.
  const oldUserAgents: PostHogOptions = { custom_blocked_useragents: [] }
  // @ts-expect-error Inherited core options must not expose the old name.
  const oldUrlHashes: PostHogOptions = { disable_capture_url_hashes: true }
  // @ts-expect-error Preview configuration names also use camelCase.
  const oldBotPageviews: PostHogOptions = { __preview_capture_bot_pageviews: true }
  void [oldHook, oldUserAgents, oldUrlHashes, oldBotPageviews]
}
