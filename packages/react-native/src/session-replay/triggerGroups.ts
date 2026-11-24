import { propertyComparisons } from '@posthog/core/surveys'
import type { FeatureFlagValue, JsonType, Logger } from '@posthog/core'

// Session replay v2 trigger groups (posthog-js V2TriggerGroupStrategy).
export type SessionReplayTriggerPropertyFilter = {
  key: string
  type?: string | null
  operator?: string | null
  value?: JsonType | null
}

export type SessionReplayTriggerEventCondition = {
  name: string
  properties: SessionReplayTriggerPropertyFilter[]
}

export type SessionReplayTriggerFlagCondition = {
  flag: string
  variant: string | null
}

// A leg counts as configured when the raw config has it, even if none of its entries parse: like
// posthog-js, an unparseable condition then never matches instead of dropping out and letting the
// group record every session. Absent flags fall back to whether any entry parsed.
export type SessionReplayTriggerConditions = {
  matchType: 'any' | 'all'
  events: SessionReplayTriggerEventCondition[]
  urls: RegExp[]
  flag: SessionReplayTriggerFlagCondition | null
  properties: SessionReplayTriggerPropertyFilter[]
  hasEventsLeg?: boolean
  hasUrlsLeg?: boolean
  hasFlagLeg?: boolean
}

export type SessionReplayTriggerGroup = {
  id: string
  name: string
  sampleRate: number | null
  minDurationMs: number | null
  conditions: SessionReplayTriggerConditions
}

// The API can send the rate as a string. A rate that isn't a finite number samples in (null), while a
// blank string reads as 0 and samples out. A JSON null rate is 0 (null * 100), unlike a missing one.
function parseTriggerGroupSampleRate(value: JsonType | undefined): number | null {
  if (value === null) {
    return 0
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return getFiniteNumber(value)
}

// null means v1: the web SDK keeps the v1 strategy unless version is 2 and the config has a group.
// A config whose groups are all unusable stays v2 with no group, so the v1 fields don't record instead.
export function parseSessionRecordingTriggerGroups(
  sessionRecording: boolean | { [key: string]: JsonType } | undefined | null,
  logger?: Pick<Logger, 'error'>
): SessionReplayTriggerGroup[] | null {
  if (!sessionRecording || typeof sessionRecording !== 'object') {
    return null
  }
  if (getFiniteNumber(sessionRecording['version']) !== 2) {
    return null
  }

  const rawGroups = sessionRecording['triggerGroups']
  if (!Array.isArray(rawGroups) || rawGroups.length === 0) {
    return null
  }

  const groups: SessionReplayTriggerGroup[] = []
  for (const raw of rawGroups) {
    if (!raw || typeof raw !== 'object') {
      continue
    }
    const map = raw as { [key: string]: JsonType }
    const id = map['id']
    if (typeof id !== 'string' || id.length === 0) {
      logger?.error('Session recording trigger group without an id was ignored.')
      continue
    }
    groups.push({
      id,
      name: typeof map['name'] === 'string' ? map['name'] : '',
      sampleRate: parseTriggerGroupSampleRate(map['sampleRate']),
      minDurationMs: getFiniteNumber(map['minDurationMs']),
      conditions: parseTriggerConditions(map['conditions'], logger),
    })
  }

  if (groups.length === 0) {
    logger?.error('Session recording has no usable trigger group, so no session is recorded.')
  }
  return groups
}

function parseTriggerConditions(
  conditions: JsonType | undefined,
  logger?: Pick<Logger, 'error'>
): SessionReplayTriggerConditions {
  const map = conditions && typeof conditions === 'object' ? (conditions as { [key: string]: JsonType }) : {}
  const rawFlag = map['flag']
  return {
    matchType: map['matchType'] === 'any' ? 'any' : 'all',
    events: parseTriggerEvents(map['events']),
    urls: parseTriggerUrls(map['urls'], logger),
    flag: parseTriggerFlag(rawFlag),
    properties: parseTriggerPropertyFilters(map['properties']),
    hasEventsLeg: Array.isArray(map['events']) && map['events'].length > 0,
    hasUrlsLeg: Array.isArray(map['urls']) && map['urls'].length > 0,
    hasFlagLeg: (typeof rawFlag === 'string' && rawFlag.length > 0) || (!!rawFlag && typeof rawFlag === 'object'),
  }
}

function parseTriggerEvents(events: JsonType | undefined): SessionReplayTriggerEventCondition[] {
  if (!Array.isArray(events)) {
    return []
  }
  const parsed: SessionReplayTriggerEventCondition[] = []
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') {
      continue
    }
    const map = raw as { [key: string]: JsonType }
    const name = map['name']
    if (typeof name !== 'string') {
      continue
    }
    parsed.push({ name, properties: parseTriggerPropertyFilters(map['properties']) })
  }
  return parsed
}

function parseTriggerUrls(urls: JsonType | undefined, logger?: Pick<Logger, 'error'>): RegExp[] {
  if (!Array.isArray(urls)) {
    return []
  }
  const parsed: RegExp[] = []
  for (const raw of urls) {
    if (!raw || typeof raw !== 'object') {
      continue
    }
    const map = raw as { [key: string]: JsonType }
    const pattern = map['url']
    if (typeof pattern !== 'string' || map['matching'] !== 'regex') {
      continue
    }
    try {
      parsed.push(new RegExp(pattern))
    } catch (e) {
      logger?.error('Invalid URL trigger regex pattern:', pattern, e)
    }
  }
  return parsed
}

function parseTriggerFlag(flag: JsonType | undefined): SessionReplayTriggerFlagCondition | null {
  if (typeof flag === 'string') {
    return { flag, variant: null }
  }
  if (flag && typeof flag === 'object') {
    const map = flag as { [key: string]: JsonType }
    const name = map['flag']
    if (typeof name === 'string') {
      const variant = map['variant']
      return { flag: name, variant: typeof variant === 'string' ? variant : null }
    }
  }
  return null
}

function parseTriggerPropertyFilters(filters: JsonType | undefined): SessionReplayTriggerPropertyFilter[] {
  if (!Array.isArray(filters)) {
    return []
  }
  const parsed: SessionReplayTriggerPropertyFilter[] = []
  for (const raw of filters) {
    if (!raw || typeof raw !== 'object') {
      continue
    }
    const map = raw as { [key: string]: JsonType }
    const key = map['key']
    if (typeof key !== 'string') {
      continue
    }
    parsed.push({
      key,
      type: typeof map['type'] === 'string' ? map['type'] : null,
      operator: typeof map['operator'] === 'string' ? map['operator'] : null,
      value: map['value'],
    })
  }
  return parsed
}

function getFiniteNumber(value: JsonType | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// A missing property satisfies these, unlike the survey event-filter matcher.
const NEGATIVE_OPERATORS: ReadonlySet<string> = new Set(['is_not', 'not_icontains', 'not_regex'])

// Mirrors posthog-js matchTriggerPropertyFilters.
export function matchTriggerPropertyFilters(
  filters: SessionReplayTriggerPropertyFilter[] | undefined | null,
  eventProperties: Record<string, unknown> | undefined,
  personProperties: Record<string, unknown> | undefined
): boolean {
  if (!filters || filters.length === 0) {
    return true
  }

  return filters.every((filter) => {
    const source = filter.type === 'person' ? personProperties : eventProperties
    const propertyValue = source?.[filter.key]
    const operator = filter.operator || 'exact'

    if (propertyValue === undefined || propertyValue === null) {
      return NEGATIVE_OPERATORS.has(operator)
    }

    const comparison = propertyComparisons[operator as keyof typeof propertyComparisons]
    if (!comparison) {
      return false
    }
    if (filter.value === undefined || filter.value === null) {
      return false
    }

    const targetValues = Array.isArray(filter.value) ? filter.value.map(String) : [String(filter.value)]
    const actualValues = Array.isArray(propertyValue) ? propertyValue.map(String) : [String(propertyValue)]

    return comparison(targetValues, actualValues)
  })
}

// Same as posthog-js simpleHash.
export function simpleTriggerHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

export function sampleOnTriggerProperty(input: string, percent: number): boolean {
  return simpleTriggerHash(input) % 100 < Math.min(100, Math.max(0, percent * 100))
}

const SCREEN_EVENT_NAME = '$screen'
const SCREEN_NAME_PROPERTY = '$screen_name'

export type SessionReplayTriggerGroupMatch = {
  id: string
  name: string
  matched: true
  sampled: boolean
}

// Mirrors posthog-js triggerGroupsMatchSessionRecordingStatus.
export type SessionReplayTriggerGroupsDecision = {
  shouldRecord: boolean
  hasPendingGroups: boolean
  minDurationMs: number | null
  groupsCount: number
  matchedGroups: SessionReplayTriggerGroupMatch[]
}

export type TriggerGroupsEventResult = {
  anyMatched: boolean
  newlyActivated: boolean
}

// Event and screen activation for one session, persisted so it survives an app restart.
export type SessionReplayTriggerGroupsActivation = {
  sessionId: string
  eventGroupIds: string[]
  screenGroupIds: string[]
}

enum TriggerStatus {
  ACTIVATED,
  PENDING,
  DISABLED,
}

// Owns every leg on React Native: its events never reach the native SDKs.
export class SessionReplayTriggerGroupsEvaluator {
  private groups: SessionReplayTriggerGroup[] = []

  private activationSessionId: string | null = null
  private eventActivatedGroupIds = new Set<string>()
  private screenActivatedGroupIds = new Set<string>()

  private samplingDecisions = new Map<string, StoredSamplingDecision>()

  private lastScreenName: string | null = null
  private lastScreenSessionId: string | null = null
  private screenCheckedSessionId: string | null = null
  private lastScreenEvaluated = false

  onConfig(groups: SessionReplayTriggerGroup[]): void {
    const survivingIds = new Set(groups.map((group) => group.id))
    for (const groupId of this.samplingDecisions.keys()) {
      if (!survivingIds.has(groupId)) {
        this.samplingDecisions.delete(groupId)
      }
    }
    this.groups = groups
  }

  // Screens stand in for the web url leg.
  onEvent(
    sessionId: string,
    eventName: string,
    eventProperties: Record<string, unknown> | undefined,
    personProperties: Record<string, unknown> | undefined
  ): TriggerGroupsEventResult {
    if (this.rememberScreen(sessionId, eventName, eventProperties)) {
      this.lastScreenEvaluated = true
    }
    this.resetActivationForNewSession(sessionId)

    let newlyActivated = this.checkScreenOnNewSession(sessionId, personProperties)
    let anyMatched = newlyActivated

    for (const group of this.groups) {
      const conditions = group.conditions

      // An already activated group still reports a match, so the caller can retry a failed native start.
      const eventMatched =
        conditions.events.length > 0 && this.matchesEventLeg(conditions, eventName, eventProperties, personProperties)
      if (eventMatched) {
        anyMatched = true
        if (!this.eventActivatedGroupIds.has(group.id)) {
          this.eventActivatedGroupIds.add(group.id)
          newlyActivated = true
        }
      }

      if (
        eventName === SCREEN_EVENT_NAME &&
        this.matchesScreenLeg(conditions, eventProperties?.[SCREEN_NAME_PROPERTY], personProperties)
      ) {
        anyMatched = true
        if (!this.screenActivatedGroupIds.has(group.id)) {
          this.screenActivatedGroupIds.add(group.id)
          newlyActivated = true
        }
      }
    }

    return { anyMatched, newlyActivated }
  }

  // Takes every $screen event, also while no group is armed, so the name is never a screen the app left.
  rememberScreen(sessionId: string, eventName: string, eventProperties: Record<string, unknown> | undefined): boolean {
    const screenName = eventName === SCREEN_EVENT_NAME ? eventProperties?.[SCREEN_NAME_PROPERTY] : undefined
    if (typeof screenName !== 'string') {
      return false
    }
    this.lastScreenName = screenName
    this.lastScreenSessionId = sessionId
    this.lastScreenEvaluated = false
    return true
  }

  // A session that started after the last $screen event gets none for the screen the app is already
  // on, so the screen leg is checked against that screen, once per session. Returns whether a group
  // newly activated. Moves activation to sessionId, so it takes the current session id only.
  checkScreenOnNewSession(sessionId: string, personProperties: Record<string, unknown> | undefined): boolean {
    if (sessionId === this.lastScreenSessionId || sessionId === this.screenCheckedSessionId) {
      return false
    }
    this.screenCheckedSessionId = sessionId
    return this.checkLastScreen(sessionId, personProperties)
  }

  // An explicit start also checks a $screen event of this session that no group was checked
  // against, because replay was stopped or no group was armed when it arrived. Once per event.
  checkScreenOnStart(sessionId: string, personProperties: Record<string, unknown> | undefined): boolean {
    if (sessionId !== this.lastScreenSessionId || this.lastScreenEvaluated) {
      return this.checkScreenOnNewSession(sessionId, personProperties)
    }
    return this.checkLastScreen(sessionId, personProperties)
  }

  private checkLastScreen(sessionId: string, personProperties: Record<string, unknown> | undefined): boolean {
    const screenName = this.lastScreenName
    if (screenName === null) {
      return false
    }
    this.lastScreenEvaluated = true
    this.resetActivationForNewSession(sessionId)

    let newlyActivated = false
    for (const group of this.groups) {
      if (
        !this.screenActivatedGroupIds.has(group.id) &&
        this.matchesScreenLeg(group.conditions, screenName, personProperties)
      ) {
        this.screenActivatedGroupIds.add(group.id)
        newlyActivated = true
      }
    }
    return newlyActivated
  }

  getActivation(): SessionReplayTriggerGroupsActivation | null {
    if (this.activationSessionId === null) {
      return null
    }
    return {
      sessionId: this.activationSessionId,
      eventGroupIds: Array.from(this.eventActivatedGroupIds),
      screenGroupIds: Array.from(this.screenActivatedGroupIds),
    }
  }

  // Clears in-memory activation (reset() calls this when the persisted one is wiped). With no
  // activation session, no group reads as activated, and the next onEvent/restoreActivation
  // clears the group sets as it would for any new session. Sampling decisions are per-session
  // cache, not activation: untouched.
  clearActivation(): void {
    this.activationSessionId = null
  }

  // Adds the persisted activation for sessionId. Activation from any other session is ignored.
  restoreActivation(sessionId: string, activation: SessionReplayTriggerGroupsActivation | null | undefined): void {
    // Storage is read back as-is, so a malformed value must not break replay evaluation.
    if (!activation || activation.sessionId !== sessionId) {
      return
    }
    this.resetActivationForNewSession(sessionId)
    for (const id of Array.isArray(activation.eventGroupIds) ? activation.eventGroupIds : []) {
      this.eventActivatedGroupIds.add(id)
    }
    for (const id of Array.isArray(activation.screenGroupIds) ? activation.screenGroupIds : []) {
      this.screenActivatedGroupIds.add(id)
    }
  }

  // Read-only for activation: a caller holding a stale session id must not wipe the current
  // session's activated groups. Only onEvent, restoreActivation and the screen checks move
  // activation to a new session.
  evaluate(
    sessionId: string,
    flags: Record<string, FeatureFlagValue> | null | undefined,
    personProperties: Record<string, unknown> | undefined
  ): SessionReplayTriggerGroupsDecision {
    const activatedSession = this.activationSessionId === sessionId

    let shouldRecord = false
    let hasPendingGroups = false
    let minDurationMs: number | null = null
    const matchedGroups: SessionReplayTriggerGroupMatch[] = []

    for (const group of this.groups) {
      switch (this.groupStatus(group, flags, activatedSession)) {
        case TriggerStatus.ACTIVATED: {
          const sampled = this.samplingDecision(group, sessionId)
          matchedGroups.push({ id: group.id, name: group.name, matched: true, sampled })
          if (sampled) {
            shouldRecord = true
          }
          const duration = group.minDurationMs
          if (duration !== null && (minDurationMs === null || duration < minDurationMs)) {
            minDurationMs = duration
          }
          break
        }
        case TriggerStatus.PENDING:
          hasPendingGroups = true
          break
        case TriggerStatus.DISABLED:
          break
      }
    }

    return { shouldRecord, hasPendingGroups, minDurationMs, groupsCount: this.groups.length, matchedGroups }
  }

  // Read-only: describes the legs keeping groups pending, as `trigger group "<name>": <condition>`,
  // while no group records the session.
  pendingConditions(sessionId: string, flags: Record<string, FeatureFlagValue> | null | undefined): string[] {
    const activatedSession = this.activationSessionId === sessionId
    const pending: string[] = []
    for (const group of this.groups) {
      const legs = this.legStatuses(group, flags, activatedSession)
      const status = combineLegs(group, legs)
      if (status === TriggerStatus.ACTIVATED && this.peekSamplingDecision(group, sessionId)) {
        return []
      }
      if (status !== TriggerStatus.PENDING || legs === null) {
        continue
      }
      // Screens stand in for the url leg. Order: url, event, flag.
      const labels: [TriggerStatus, string][] = [
        [legs.screen, 'URL condition not matched'],
        [legs.event, 'event condition not matched'],
        [legs.flag, 'linked flag condition not matched'],
      ]
      for (const [legStatus, label] of labels) {
        if (legStatus === TriggerStatus.PENDING) {
          pending.push(`trigger group "${group.name}": ${label}`)
        }
      }
    }
    return pending
  }

  private groupStatus(
    group: SessionReplayTriggerGroup,
    flags: Record<string, FeatureFlagValue> | null | undefined,
    activatedSession: boolean
  ): TriggerStatus {
    return combineLegs(group, this.legStatuses(group, flags, activatedSession))
  }

  // null for a group with no conditions, which records every session it samples in.
  private legStatuses(
    group: SessionReplayTriggerGroup,
    flags: Record<string, FeatureFlagValue> | null | undefined,
    activatedSession: boolean
  ): TriggerLegStatuses | null {
    const conditions = group.conditions
    const hasEvents = conditions.hasEventsLeg ?? conditions.events.length > 0
    const hasUrls = conditions.hasUrlsLeg ?? conditions.urls.length > 0
    const hasFlag = conditions.hasFlagLeg ?? conditions.flag !== null

    if (!hasEvents && !hasUrls && !hasFlag) {
      return null
    }

    return {
      event: !hasEvents
        ? TriggerStatus.DISABLED
        : activatedSession && this.eventActivatedGroupIds.has(group.id)
          ? TriggerStatus.ACTIVATED
          : TriggerStatus.PENDING,
      screen: !hasUrls
        ? TriggerStatus.DISABLED
        : activatedSession && this.screenActivatedGroupIds.has(group.id)
          ? TriggerStatus.ACTIVATED
          : TriggerStatus.PENDING,
      flag: hasFlag ? this.flagLegStatus(conditions.flag, flags) : TriggerStatus.DISABLED,
    }
  }

  private flagLegStatus(
    flag: SessionReplayTriggerFlagCondition | null,
    flags: Record<string, FeatureFlagValue> | null | undefined
  ): TriggerStatus {
    // A configured flag leg that didn't parse never matches.
    if (flag === null || flags === null || flags === undefined) {
      return TriggerStatus.PENDING
    }

    const value = flags[flag.flag]
    const matches =
      typeof value === 'boolean'
        ? value
        : typeof value === 'string'
          ? flag.variant !== null
            ? value === flag.variant
            : // a multivariant flag linked to "any" matches any non-empty variant
              value.length > 0
          : false

    return matches ? TriggerStatus.ACTIVATED : TriggerStatus.PENDING
  }

  private matchesScreenLeg(
    conditions: SessionReplayTriggerConditions,
    screenName: unknown,
    personProperties: Record<string, unknown> | undefined
  ): boolean {
    return (
      conditions.urls.length > 0 &&
      typeof screenName === 'string' &&
      conditions.urls.some((regex) => regex.test(screenName)) &&
      // The url leg checks the group-level filters without event properties.
      matchTriggerPropertyFilters(conditions.properties, undefined, personProperties)
    )
  }

  private matchesEventLeg(
    conditions: SessionReplayTriggerConditions,
    eventName: string,
    eventProperties: Record<string, unknown> | undefined,
    personProperties: Record<string, unknown> | undefined
  ): boolean {
    const namedEntries = conditions.events.filter((entry) => entry.name === eventName)
    if (namedEntries.length === 0) {
      return false
    }

    const entryMatched = namedEntries.some(
      (entry) =>
        entry.properties.length === 0 ||
        matchTriggerPropertyFilters(entry.properties, eventProperties, personProperties)
    )
    if (!entryMatched) {
      return false
    }

    return matchTriggerPropertyFilters(conditions.properties, eventProperties, personProperties)
  }

  private samplingDecision(group: SessionReplayTriggerGroup, sessionId: string): boolean {
    const sampled = this.peekSamplingDecision(group, sessionId)
    this.samplingDecisions.set(group.id, { sessionId, sampleRate: group.sampleRate, sampled })
    return sampled
  }

  private peekSamplingDecision(group: SessionReplayTriggerGroup, sessionId: string): boolean {
    const stored = this.samplingDecisions.get(group.id)
    if (stored && stored.sessionId === sessionId && stored.sampleRate === group.sampleRate) {
      return stored.sampled
    }
    // A missing rate samples in, like the web clamp fallback.
    return group.sampleRate !== null ? sampleOnTriggerProperty(sessionId + group.id, group.sampleRate) : true
  }

  private resetActivationForNewSession(sessionId: string): void {
    if (this.activationSessionId !== sessionId) {
      this.activationSessionId = sessionId
      this.eventActivatedGroupIds.clear()
      this.screenActivatedGroupIds.clear()
    }
  }
}

type TriggerLegStatuses = {
  event: TriggerStatus
  screen: TriggerStatus
  flag: TriggerStatus
}

function combineLegs(group: SessionReplayTriggerGroup, legs: TriggerLegStatuses | null): TriggerStatus {
  if (legs === null) {
    return TriggerStatus.ACTIVATED
  }
  return group.conditions.matchType === 'any'
    ? orTriggerStatus(legs.event, legs.screen, legs.flag)
    : andTriggerStatus(legs.event, legs.screen, legs.flag)
}

type StoredSamplingDecision = {
  sessionId: string
  sampleRate: number | null
  sampled: boolean
}

function orTriggerStatus(...statuses: TriggerStatus[]): TriggerStatus {
  if (statuses.includes(TriggerStatus.ACTIVATED)) {
    return TriggerStatus.ACTIVATED
  }
  if (statuses.includes(TriggerStatus.PENDING)) {
    return TriggerStatus.PENDING
  }
  return TriggerStatus.DISABLED
}

function andTriggerStatus(...statuses: TriggerStatus[]): TriggerStatus {
  const enabled = new Set(statuses.filter((status) => status !== TriggerStatus.DISABLED))
  switch (enabled.size) {
    case 0:
      return TriggerStatus.DISABLED
    case 1:
      return Array.from(enabled)[0]
    default:
      return TriggerStatus.PENDING
  }
}
