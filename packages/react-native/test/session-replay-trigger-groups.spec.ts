import {
  SessionReplayTriggerGroupsEvaluator,
  matchTriggerPropertyFilters,
  parseSessionRecordingTriggerGroups,
  sampleOnTriggerProperty,
  simpleTriggerHash,
  type SessionReplayTriggerGroup,
} from '../src/session-replay/triggerGroups'

const group = (overrides: Partial<SessionReplayTriggerGroup> = {}): SessionReplayTriggerGroup => ({
  id: 'g1',
  name: 'Group 1',
  sampleRate: null,
  minDurationMs: null,
  conditions: {
    matchType: 'all',
    events: [],
    urls: [],
    flag: null,
    properties: [],
  },
  ...overrides,
})

const conditions = (overrides: Partial<SessionReplayTriggerGroup['conditions']> = {}) => ({
  matchType: 'all' as const,
  events: [],
  urls: [],
  flag: null,
  properties: [],
  ...overrides,
})

// session ids chosen so simpleTriggerHash(sessionId + 'g1') % 100 is 5 (session-31) and
// 95 (session-295): a 0.1 rate includes the first and excludes the second.
const SAMPLED_IN_SESSION = 'session-31'
const SAMPLED_OUT_SESSION = 'session-295'

describe('parseSessionRecordingTriggerGroups', () => {
  it('returns null for missing, v1 and malformed configs', () => {
    expect(parseSessionRecordingTriggerGroups(undefined)).toBeNull()
    expect(parseSessionRecordingTriggerGroups(false)).toBeNull()
    expect(parseSessionRecordingTriggerGroups({})).toBeNull()
    expect(parseSessionRecordingTriggerGroups({ version: 1, eventTriggers: ['$pageview'] })).toBeNull()
    expect(parseSessionRecordingTriggerGroups({ version: '2', triggerGroups: [] })).toBeNull()
    expect(parseSessionRecordingTriggerGroups({ version: 2 })).toBeNull()
    expect(parseSessionRecordingTriggerGroups({ version: 2, triggerGroups: {} })).toBeNull()
    expect(parseSessionRecordingTriggerGroups({ version: 2, triggerGroups: [{ no: 'id' }] })).toBeNull()
  })

  it('parses groups, conditions and filters from a v2 config', () => {
    const groups = parseSessionRecordingTriggerGroups({
      version: 2,
      triggerGroups: [
        {
          id: 'g1',
          name: 'Checkout',
          sampleRate: 0.5,
          minDurationMs: 1000,
          conditions: {
            matchType: 'any',
            events: [{ name: 'purchase', properties: [{ key: 'amount', operator: 'gt', value: 100 }] }],
            urls: [
              { url: 'checkout.*', matching: 'regex' },
              { url: 'dropped-exact-entry', matching: 'exact' },
            ],
            flag: { flag: 'replay-flag', variant: 'beta' },
            properties: [{ key: 'plan', type: 'person', operator: 'exact', value: 'pro' }],
          },
        },
      ],
    })

    expect(groups).toEqual([
      {
        id: 'g1',
        name: 'Checkout',
        sampleRate: 0.5,
        minDurationMs: 1000,
        conditions: {
          matchType: 'any',
          events: [{ name: 'purchase', properties: [{ key: 'amount', type: null, operator: 'gt', value: 100 }] }],
          urls: [/checkout.*/],
          flag: { flag: 'replay-flag', variant: 'beta' },
          properties: [{ key: 'plan', type: 'person', operator: 'exact', value: 'pro' }],
        },
      },
    ])
  })

  it('ignores malformed entries inside a valid group list', () => {
    const groups = parseSessionRecordingTriggerGroups({
      version: 2,
      triggerGroups: [null, 42, { id: '' }, { id: 'g1', sampleRate: 'nope', conditions: null }],
    })

    expect(groups).toEqual([
      {
        id: 'g1',
        name: '',
        sampleRate: null,
        minDurationMs: null,
        conditions: { matchType: 'all', events: [], urls: [], flag: null, properties: [] },
      },
    ])
  })
})

describe('simpleTriggerHash', () => {
  it('matches the web simpleHash vectors', () => {
    expect(simpleTriggerHash('abc')).toBe(96354)
    expect(simpleTriggerHash('posthog')).toBe(391202912)
  })
})

describe('matchTriggerPropertyFilters', () => {
  const filters = (filter: Record<string, unknown>) => [filter as never]

  it('matches when no filters are configured', () => {
    expect(matchTriggerPropertyFilters(undefined, {}, {})).toBe(true)
    expect(matchTriggerPropertyFilters([], {}, {})).toBe(true)
  })

  it('compares exactly (case-sensitive, like the web propertyComparisons) and across arrays', () => {
    expect(matchTriggerPropertyFilters(filters({ key: 'plan', value: 'Pro' }), { plan: 'Pro' }, {})).toBe(true)
    expect(matchTriggerPropertyFilters(filters({ key: 'plan', value: 'Pro' }), { plan: 'PRO' }, {})).toBe(false)
    expect(
      matchTriggerPropertyFilters(filters({ key: 'plan', value: ['pro', 'enterprise'] }), { plan: 'enterprise' }, {})
    ).toBe(true)
    expect(matchTriggerPropertyFilters(filters({ key: 'plan', value: 'pro' }), { plan: 'free' }, {})).toBe(false)
    // Numbers compare as strings, like the web helper's String() normalisation.
    expect(matchTriggerPropertyFilters(filters({ key: 'amount', value: 100 }), { amount: 100 }, {})).toBe(true)
  })

  it('treats a missing property as matching only negative operators', () => {
    expect(matchTriggerPropertyFilters(filters({ key: 'region', operator: 'is_not', value: 'EU' }), {}, {})).toBe(true)
    expect(
      matchTriggerPropertyFilters(filters({ key: 'region', operator: 'not_icontains', value: 'eu' }), {}, {})
    ).toBe(true)
    expect(matchTriggerPropertyFilters(filters({ key: 'region', operator: 'not_regex', value: 'eu.*' }), {}, {})).toBe(
      true
    )
    expect(matchTriggerPropertyFilters(filters({ key: 'region', operator: 'exact', value: 'EU' }), {}, {})).toBe(false)
    expect(matchTriggerPropertyFilters(filters({ key: 'region', operator: 'icontains', value: 'e' }), {}, {})).toBe(
      false
    )
    expect(
      matchTriggerPropertyFilters(filters({ key: 'region', operator: 'is_not', value: 'EU' }), { region: 'EU' }, {})
    ).toBe(false)
  })

  it('supports icontains, regex and gt operators', () => {
    expect(
      matchTriggerPropertyFilters(
        filters({ key: 'email', operator: 'icontains', value: 'HOG' }),
        { email: 'me@posthog.com' },
        {}
      )
    ).toBe(true)
    expect(
      matchTriggerPropertyFilters(
        filters({ key: 'email', operator: 'not_icontains', value: 'hog' }),
        { email: 'me@posthog.com' },
        {}
      )
    ).toBe(false)
    expect(
      matchTriggerPropertyFilters(
        filters({ key: 'path', operator: 'regex', value: '^/checkout' }),
        { path: '/checkout/step-2' },
        {}
      )
    ).toBe(true)
    expect(
      matchTriggerPropertyFilters(
        filters({ key: 'path', operator: 'not_regex', value: '^/checkout' }),
        { path: '/checkout/step-2' },
        {}
      )
    ).toBe(false)
    // gt/lt compare numerically, including parseFloat-style prefixes.
    expect(
      matchTriggerPropertyFilters(filters({ key: 'amount', operator: 'gt', value: '99' }), { amount: '100items' }, {})
    ).toBe(true)
    expect(
      matchTriggerPropertyFilters(filters({ key: 'amount', operator: 'gt', value: 100 }), { amount: 99 }, {})
    ).toBe(false)
  })

  it('reads person properties for type person and event properties otherwise', () => {
    const personFilters = filters({ key: 'plan', type: 'person', operator: 'exact', value: 'pro' })
    expect(matchTriggerPropertyFilters(personFilters, { plan: 'free' }, { plan: 'pro' })).toBe(true)
    expect(matchTriggerPropertyFilters(personFilters, { plan: 'pro' }, {})).toBe(false)
    expect(
      matchTriggerPropertyFilters(
        filters({ key: 'plan', operator: 'exact', value: 'free' }),
        { plan: 'free' },
        { plan: 'pro' }
      )
    ).toBe(true)
  })

  it('requires a filter value and a known operator', () => {
    expect(matchTriggerPropertyFilters(filters({ key: 'plan' }), { plan: 'pro' }, {})).toBe(false)
    expect(matchTriggerPropertyFilters(filters({ key: 'plan', value: null }), { plan: 'pro' }, {})).toBe(false)
    expect(
      matchTriggerPropertyFilters(filters({ key: 'plan', operator: 'bogus', value: 'pro' }), { plan: 'pro' }, {})
    ).toBe(false)
  })
})

describe('SessionReplayTriggerGroupsEvaluator', () => {
  it('activates a group with empty conditions immediately', () => {
    const evaluator = new SessionReplayTriggerGroupsEvaluator()
    evaluator.onConfig([group()])

    const decision = evaluator.evaluate('s1', null, undefined)
    expect(decision.shouldRecord).toBe(true)
    expect(decision.hasPendingGroups).toBe(false)
    expect(decision.matchedGroups).toEqual([{ id: 'g1', name: 'Group 1', matched: true, sampled: true }])
  })

  describe('any/all combining with disabled legs', () => {
    it('any: ACTIVATED wins over PENDING, PENDING over DISABLED', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([
        group({ conditions: conditions({ matchType: 'any', flag: { flag: 'off-flag', variant: null } }) }),
      ])

      // Flag off (PENDING) and no events/urls (DISABLED) -> pending, not disabled.
      expect(evaluator.evaluate('s1', { 'off-flag': false }, undefined).hasPendingGroups).toBe(true)

      evaluator.onConfig([
        group({
          id: 'g1',
          conditions: conditions({
            matchType: 'any',
            events: [{ name: 'purchase', properties: [] }],
            flag: { flag: 'off-flag', variant: null },
          }),
        }),
      ])
      // Event leg ACTIVATED beats the still-pending flag leg.
      evaluator.onEvent('s1', 'purchase', undefined, undefined)
      const decision = evaluator.evaluate('s1', { 'off-flag': false }, undefined)
      expect(decision.shouldRecord).toBe(true)
      expect(decision.hasPendingGroups).toBe(false)
    })

    it('all: drops disabled legs and requires every configured leg', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([
        group({
          conditions: conditions({
            matchType: 'all',
            events: [{ name: 'purchase', properties: [] }],
            urls: [/checkout/],
          }),
        }),
      ])

      // Event pending, url pending -> pending.
      expect(evaluator.evaluate('s1', null, undefined).hasPendingGroups).toBe(true)
      // Event activated only -> still pending.
      evaluator.onEvent('s1', 'purchase', undefined, undefined)
      expect(evaluator.evaluate('s1', null, undefined).hasPendingGroups).toBe(true)
      // Screen matching the url regex activates the second leg.
      evaluator.onEvent('s1', '$screen', { $screen_name: '/checkout/step-2' }, undefined)
      expect(evaluator.evaluate('s1', null, undefined).shouldRecord).toBe(true)
    })

    it('all: a single configured leg decides alone', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([
        group({ conditions: conditions({ matchType: 'all', events: [{ name: 'purchase', properties: [] }] }) }),
      ])

      expect(evaluator.evaluate('s1', null, undefined).hasPendingGroups).toBe(true)
      evaluator.onEvent('s1', 'purchase', undefined, undefined)
      expect(evaluator.evaluate('s1', null, undefined).shouldRecord).toBe(true)
    })
  })

  describe('event leg property filters', () => {
    const eventLeg = (
      events: SessionReplayTriggerGroup['conditions']['events'],
      properties: SessionReplayTriggerGroup['conditions']['properties']
    ) => group({ conditions: conditions({ events, properties }) })

    it('requires per-event filters to match, treating same-name entries as a disjunction', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([
        eventLeg(
          [
            { name: 'purchase', properties: [{ key: 'amount', operator: 'gt', value: 100 }] },
            { name: 'purchase', properties: [] },
          ],
          []
        ),
      ])

      // The unconditional same-name entry matches even when the filtered one does not.
      expect(evaluator.onEvent('s1', 'purchase', { amount: 1 }, undefined).newlyActivated).toBe(true)

      evaluator.onConfig([
        eventLeg([{ name: 'purchase', properties: [{ key: 'amount', operator: 'gt', value: 100 }] }], []),
      ])
      expect(evaluator.onEvent('s2', 'purchase', { amount: 1 }, undefined).newlyActivated).toBe(false)
      expect(evaluator.onEvent('s2', 'purchase', { amount: 500 }, undefined).newlyActivated).toBe(true)
    })

    it('gates the event leg on group-level filters, including person properties', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([
        eventLeg(
          [{ name: 'purchase', properties: [] }],
          [{ key: 'plan', type: 'person', operator: 'exact', value: 'pro' }]
        ),
      ])

      expect(evaluator.onEvent('s1', 'purchase', {}, { plan: 'free' }).newlyActivated).toBe(false)
      expect(evaluator.onEvent('s1', 'purchase', {}, { plan: 'pro' }).newlyActivated).toBe(true)
    })

    it('is_not matches when the filtered property is missing', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([
        eventLeg([{ name: 'purchase', properties: [{ key: 'region', operator: 'is_not', value: 'EU' }] }], []),
      ])

      expect(evaluator.onEvent('s1', 'purchase', {}, undefined).newlyActivated).toBe(true)

      evaluator.onConfig([
        eventLeg([{ name: 'purchase', properties: [{ key: 'region', operator: 'is_not', value: 'EU' }] }], []),
      ])
      expect(evaluator.onEvent('s2', 'purchase', { region: 'EU' }, undefined).newlyActivated).toBe(false)
    })

    it('supports icontains and regex per-event filters', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([
        eventLeg(
          [{ name: 'signup', properties: [{ key: 'email', operator: 'icontains', value: '@posthog.com' }] }],
          []
        ),
      ])
      expect(evaluator.onEvent('s1', 'signup', { email: 'Me@PostHog.com' }, undefined).newlyActivated).toBe(true)

      evaluator.onConfig([
        eventLeg([{ name: 'signup', properties: [{ key: 'path', operator: 'regex', value: '^/onboard' }] }], []),
      ])
      expect(evaluator.onEvent('s2', 'signup', { path: '/onboarding/step-1' }, undefined).newlyActivated).toBe(true)
      expect(evaluator.onEvent('s2', 'signup', { path: '/pricing' }, undefined).anyMatched).toBe(false)
    })
  })

  describe('screen (url) leg', () => {
    it('activates on a screen name matching any urls regex, gated by group-level properties', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([
        group({
          conditions: conditions({
            urls: [/^checkout/, /.*payment.*$/],
            properties: [{ key: 'locale', operator: 'exact', value: 'en-US' }],
          }),
        }),
      ])

      expect(evaluator.onEvent('s1', '$screen', { $screen_name: 'Home' }, undefined).anyMatched).toBe(false)
      // Regex matches but the group-level property does not.
      expect(evaluator.onEvent('s1', '$screen', { $screen_name: 'checkout-step-1' }, undefined).anyMatched).toBe(false)
      expect(
        evaluator.onEvent('s1', '$screen', { $screen_name: 'checkout-step-1', locale: 'en-US' }, undefined)
          .newlyActivated
      ).toBe(true)
      // A second group with a different regex in the list also matches the same screen.
      evaluator.onConfig([group({ id: 'g2', conditions: conditions({ urls: [/.*payment.*$/] }) })])
      expect(evaluator.onEvent('s1', '$screen', { $screen_name: 'payment-success' }, undefined).anyMatched).toBe(true)
    })

    it('ignores non-screen events for the url leg', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([group({ conditions: conditions({ urls: [/anything/] }) })])

      expect(evaluator.onEvent('s1', 'purchase', { $screen_name: 'anything' }, undefined).anyMatched).toBe(false)
    })
  })

  describe('flag leg', () => {
    it('activates on a boolean flag and keeps waiting while off or unknown', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([group({ conditions: conditions({ flag: { flag: 'replay-flag', variant: null } }) })])

      // Flags not loaded -> pending.
      expect(evaluator.evaluate('s1', null, undefined).hasPendingGroups).toBe(true)
      expect(evaluator.evaluate('s1', undefined, undefined).hasPendingGroups).toBe(true)
      // Loaded but off -> still pending.
      expect(evaluator.evaluate('s1', { 'replay-flag': false }, undefined).hasPendingGroups).toBe(true)
      // On -> activated.
      expect(evaluator.evaluate('s1', { 'replay-flag': true }, undefined).shouldRecord).toBe(true)
    })

    it('activates on a specific variant, any non-empty variant, or a flag+variant pair', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([
        group({ id: 'any-variant', conditions: conditions({ flag: { flag: 'multivariant', variant: null } }) }),
        group({ id: 'fixed-variant', conditions: conditions({ flag: { flag: 'multivariant', variant: 'beta' } }) }),
      ])

      const beta = evaluator.evaluate('s1', { multivariant: 'beta' }, undefined)
      expect(beta.shouldRecord).toBe(true)
      expect(beta.matchedGroups.map((match) => match.id)).toEqual(['any-variant', 'fixed-variant'])

      const alpha = evaluator.evaluate('s1', { multivariant: 'alpha' }, undefined)
      expect(alpha.matchedGroups.map((match) => match.id)).toEqual(['any-variant'])
    })
  })

  describe('per-group sampling', () => {
    it('includes and excludes sessions by simpleHash(sessionId + groupId)', () => {
      // Vectors computed from the web helper: hash('posthog') % 100 == 12, hash('abc') % 100 == 54.
      expect(sampleOnTriggerProperty('posthog', 0.13)).toBe(true)
      expect(sampleOnTriggerProperty('posthog', 0.12)).toBe(false)
      expect(sampleOnTriggerProperty('abc', 0.55)).toBe(true)
      expect(sampleOnTriggerProperty('abc', 0.54)).toBe(false)

      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([group({ sampleRate: 0.1 })])

      expect(evaluator.evaluate(SAMPLED_IN_SESSION, null, undefined).shouldRecord).toBe(true)
      expect(evaluator.evaluate(SAMPLED_OUT_SESSION, null, undefined).shouldRecord).toBe(false)
      // A sampled-out activated group is still reported as matched, just not sampled.
      expect(evaluator.evaluate(SAMPLED_OUT_SESSION, null, undefined).matchedGroups).toEqual([
        { id: 'g1', name: 'Group 1', matched: true, sampled: false },
      ])
    })

    it('keeps one decision per session and re-decides on session or sample-rate change', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([group({ sampleRate: 1 })])

      const first = evaluator.evaluate(SAMPLED_IN_SESSION, null, undefined)
      expect(first.matchedGroups[0].sampled).toBe(true)
      // Same session, same rate: stable decision.
      expect(evaluator.evaluate(SAMPLED_IN_SESSION, null, undefined).matchedGroups[0].sampled).toBe(true)

      // Rate change to 0 re-decides (and excludes).
      evaluator.onConfig([group({ sampleRate: 0 })])
      expect(evaluator.evaluate(SAMPLED_IN_SESSION, null, undefined).matchedGroups[0].sampled).toBe(false)

      // Session change re-decides with the original include-everything rate.
      evaluator.onConfig([group({ sampleRate: 1 })])
      const stored = (evaluator as unknown as { samplingDecisions: Map<string, { sessionId: string }> })
        .samplingDecisions
      expect(Array.from(stored.values()).every((entry) => entry.sessionId === SAMPLED_IN_SESSION)).toBe(true)
      evaluator.evaluate(SAMPLED_OUT_SESSION, null, undefined)
      expect(Array.from(stored.values()).every((entry) => entry.sessionId === SAMPLED_OUT_SESSION)).toBe(true)
    })

    it('treats a missing sample rate as fully sampled', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([group({ sampleRate: null })])

      expect(evaluator.evaluate(SAMPLED_OUT_SESSION, null, undefined).shouldRecord).toBe(true)
    })
  })

  describe('union decision and minimum duration', () => {
    it('records when any activated group sampled in, regardless of other groups', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([
        group({ id: 'sampled-out', sampleRate: 0 }),
        group({ id: 'pending', conditions: conditions({ flag: { flag: 'off', variant: null } }) }),
        group({ id: 'sampled-in', sampleRate: 1 }),
      ])

      const decision = evaluator.evaluate('s1', { off: false }, undefined)
      expect(decision.shouldRecord).toBe(true)
      expect(decision.hasPendingGroups).toBe(true)
      expect(decision.matchedGroups.map((match) => match.id)).toEqual(['sampled-out', 'sampled-in'])
    })

    it('keeps waiting while a group is still pending', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([
        group({ id: 'pending', conditions: conditions({ events: [{ name: 'purchase', properties: [] }] }) }),
      ])

      const decision = evaluator.evaluate('s1', null, undefined)
      expect(decision.shouldRecord).toBe(false)
      expect(decision.hasPendingGroups).toBe(true)
    })

    it('does not record when all activated groups sampled out and nothing is pending', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([group({ sampleRate: 0 })])

      const decision = evaluator.evaluate(SAMPLED_IN_SESSION, null, undefined)
      expect(decision.shouldRecord).toBe(false)
      expect(decision.hasPendingGroups).toBe(false)
    })

    it('reports the lowest minDurationMs among activated groups only', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([
        group({
          id: 'a',
          minDurationMs: 5000,
          conditions: conditions({ events: [{ name: 'never', properties: [] }] }),
        }),
        group({ id: 'b', minDurationMs: 1000 }),
        group({ id: 'c', minDurationMs: 300 }),
      ])

      expect(evaluator.evaluate('s1', null, undefined).minDurationMs).toBe(300)

      // Only the activated group's duration counts once the others are gone.
      evaluator.onConfig([
        group({
          id: 'a',
          minDurationMs: 5000,
          conditions: conditions({ events: [{ name: 'purchase', properties: [] }] }),
        }),
      ])
      evaluator.onEvent('s1', 'purchase', undefined, undefined)
      expect(evaluator.evaluate('s1', null, undefined).minDurationMs).toBe(5000)
    })

    it('reports null minDurationMs when no activated group sets one', () => {
      const evaluator = new SessionReplayTriggerGroupsEvaluator()
      evaluator.onConfig([
        group({
          id: 'a',
          minDurationMs: 5000,
          conditions: conditions({ events: [{ name: 'never', properties: [] }] }),
        }),
        group({ id: 'b' }),
      ])

      expect(evaluator.evaluate('s1', null, undefined).minDurationMs).toBeNull()
    })
  })

  it('resets activation on a new session id and keeps it sticky within a session', () => {
    const evaluator = new SessionReplayTriggerGroupsEvaluator()
    evaluator.onConfig([group({ conditions: conditions({ events: [{ name: 'purchase', properties: [] }] }) })])

    expect(evaluator.onEvent('s1', 'purchase', undefined, undefined).newlyActivated).toBe(true)
    // Sticky: a later non-matching event does not report a match or deactivate.
    expect(evaluator.onEvent('s1', 'other', undefined, undefined).anyMatched).toBe(false)
    expect(evaluator.evaluate('s1', null, undefined).shouldRecord).toBe(true)

    // New session: activation is gone until a fresh matching event.
    const decision = evaluator.evaluate('s2', null, undefined)
    expect(decision.shouldRecord).toBe(false)
    expect(decision.hasPendingGroups).toBe(true)
    expect(evaluator.onEvent('s2', 'purchase', undefined, undefined).newlyActivated).toBe(true)
  })
})
