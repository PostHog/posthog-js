import {
    OrMatching,
    AndMatching,
    OrTriggerMatching,
    AndTriggerMatching,
    MatchResult,
    TriggerStatusMatching,
    TriggerStatus,
    TRIGGER_ACTIVATED,
    TRIGGER_PENDING,
    TRIGGER_DISABLED,
    toTriggerStatus,
    toMatchResult,
} from '../../../extensions/replay/external/triggerMatching'

class StubMatcher<TInput, TResult> implements TriggerStatusMatching<TInput, TResult> {
    version = null
    stopped = false

    constructor(private readonly _result: TResult) {}

    matches(): TResult {
        return this._result
    }

    stop(): void {
        this.stopped = true
    }
}

const matchResult = (matched: boolean, configured: boolean): MatchResult => ({ matched, configured })

describe('toMatchResult and toTriggerStatus conversion', () => {
    it.each([
        [TRIGGER_ACTIVATED, { matched: true, configured: true, context: TRIGGER_ACTIVATED }],
        [TRIGGER_PENDING, { matched: false, configured: true, context: TRIGGER_PENDING }],
        [TRIGGER_DISABLED, { matched: false, configured: false, context: TRIGGER_DISABLED }],
    ])('toMatchResult(%s) returns %o', (status, expected) => {
        expect(toMatchResult(status)).toEqual(expected)
    })

    it.each([
        [{ matched: true, configured: true }, TRIGGER_ACTIVATED],
        [{ matched: true, configured: false }, TRIGGER_ACTIVATED],
        [{ matched: false, configured: true }, TRIGGER_PENDING],
        [{ matched: false, configured: false }, TRIGGER_DISABLED],
    ])('toTriggerStatus(%o) returns %s', (result, expected) => {
        expect(toTriggerStatus(result)).toBe(expected)
    })
})

describe('OrMatching (generic)', () => {
    it.each([
        {
            name: 'returns matched when any matcher matches',
            results: [matchResult(true, true), matchResult(false, true)],
            expected: matchResult(true, true),
        },
        {
            name: 'returns matched from first matching matcher',
            results: [matchResult(false, true), matchResult(true, true)],
            expected: matchResult(true, true),
        },
        {
            name: 'returns configured:true when all configured but none match',
            results: [matchResult(false, true), matchResult(false, true)],
            expected: matchResult(false, true),
        },
        {
            name: 'returns configured:false when none configured',
            results: [matchResult(false, false), matchResult(false, false)],
            expected: matchResult(false, false),
        },
        {
            name: 'returns configured:true when mixed configured states, none match',
            results: [matchResult(false, true), matchResult(false, false)],
            expected: matchResult(false, true),
        },
        {
            name: 'single matcher matched',
            results: [matchResult(true, true)],
            expected: matchResult(true, true),
        },
        {
            name: 'single matcher not configured',
            results: [matchResult(false, false)],
            expected: matchResult(false, false),
        },
        {
            name: 'empty matchers returns not configured',
            results: [],
            expected: matchResult(false, false),
        },
    ])('$name', ({ results, expected }) => {
        const matchers = results.map((r) => new StubMatcher<string, MatchResult>(r))
        const or = new OrMatching(matchers)
        expect(or.matches('test')).toEqual(expected)
    })

    it('stops all matchers', () => {
        const matchers = [
            new StubMatcher<string, MatchResult>(matchResult(false, true)),
            new StubMatcher<string, MatchResult>(matchResult(false, true)),
        ]
        const or = new OrMatching(matchers)
        or.stop()
        expect(matchers.every((m) => m.stopped)).toBe(true)
    })
})

describe('AndMatching (generic)', () => {
    it.each([
        {
            name: 'returns matched when all configured matchers match',
            results: [matchResult(true, true), matchResult(true, true)],
            expected: matchResult(true, true),
        },
        {
            name: 'returns not matched when any configured matcher does not match',
            results: [matchResult(true, true), matchResult(false, true)],
            expected: matchResult(false, true),
        },
        {
            name: 'returns not matched when none match',
            results: [matchResult(false, true), matchResult(false, true)],
            expected: matchResult(false, true),
        },
        {
            name: 'ignores not-configured matchers - all remaining match',
            results: [matchResult(true, true), matchResult(false, false)],
            expected: matchResult(true, true),
        },
        {
            name: 'ignores not-configured matchers - remaining does not match',
            results: [matchResult(false, true), matchResult(false, false)],
            expected: matchResult(false, true),
        },
        {
            name: 'returns not configured when all matchers not configured',
            results: [matchResult(false, false), matchResult(false, false)],
            expected: matchResult(false, false),
        },
        {
            name: 'single configured matcher matched',
            results: [matchResult(true, true)],
            expected: matchResult(true, true),
        },
        {
            name: 'single configured matcher not matched',
            results: [matchResult(false, true)],
            expected: matchResult(false, true),
        },
        {
            name: 'empty matchers returns not configured',
            results: [],
            expected: matchResult(false, false),
        },
    ])('$name', ({ results, expected }) => {
        const matchers = results.map((r) => new StubMatcher<string, MatchResult>(r))
        const and = new AndMatching(matchers)
        expect(and.matches('test')).toEqual(expected)
    })

    it('stops all matchers', () => {
        const matchers = [
            new StubMatcher<string, MatchResult>(matchResult(true, true)),
            new StubMatcher<string, MatchResult>(matchResult(true, true)),
        ]
        const and = new AndMatching(matchers)
        and.stop()
        expect(matchers.every((m) => m.stopped)).toBe(true)
    })
})

describe('OrTriggerMatching (backwards compatibility)', () => {
    it.each([
        {
            name: 'returns ACTIVATED when any matcher is ACTIVATED',
            statuses: [TRIGGER_ACTIVATED, TRIGGER_PENDING],
            expected: TRIGGER_ACTIVATED,
        },
        {
            name: 'returns ACTIVATED when first is ACTIVATED',
            statuses: [TRIGGER_ACTIVATED, TRIGGER_DISABLED],
            expected: TRIGGER_ACTIVATED,
        },
        {
            name: 'returns PENDING when any is PENDING and none ACTIVATED',
            statuses: [TRIGGER_PENDING, TRIGGER_DISABLED],
            expected: TRIGGER_PENDING,
        },
        {
            name: 'returns DISABLED when all DISABLED',
            statuses: [TRIGGER_DISABLED, TRIGGER_DISABLED],
            expected: TRIGGER_DISABLED,
        },
        {
            name: 'single ACTIVATED',
            statuses: [TRIGGER_ACTIVATED],
            expected: TRIGGER_ACTIVATED,
        },
        {
            name: 'single PENDING',
            statuses: [TRIGGER_PENDING],
            expected: TRIGGER_PENDING,
        },
        {
            name: 'single DISABLED',
            statuses: [TRIGGER_DISABLED],
            expected: TRIGGER_DISABLED,
        },
        {
            name: 'ACTIVATED wins over multiple PENDING',
            statuses: [TRIGGER_PENDING, TRIGGER_ACTIVATED, TRIGGER_PENDING],
            expected: TRIGGER_ACTIVATED,
        },
        {
            name: 'empty matchers returns DISABLED',
            statuses: [],
            expected: TRIGGER_DISABLED,
        },
    ])('$name', ({ statuses, expected }) => {
        const matchers = statuses.map((s) => new StubMatcher<string, TriggerStatus>(s))
        const or = new OrTriggerMatching(matchers)
        expect(or.matches('session-123')).toBe(expected)
    })
})

describe('version field', () => {
    it('OrMatching has version replay-2026-02', () => {
        const or = new OrMatching([])
        expect(or.version).toBe('replay-2026-02')
    })

    it('AndMatching has version replay-2026-02', () => {
        const and = new AndMatching([])
        expect(and.version).toBe('replay-2026-02')
    })

    it('OrTriggerMatching has version null', () => {
        const or = new OrTriggerMatching([])
        expect(or.version).toBe(null)
    })

    it('AndTriggerMatching has version null', () => {
        const and = new AndTriggerMatching([])
        expect(and.version).toBe(null)
    })
})

describe('AndTriggerMatching (backwards compatibility)', () => {
    it.each([
        {
            name: 'returns ACTIVATED when all configured are ACTIVATED',
            statuses: [TRIGGER_ACTIVATED, TRIGGER_ACTIVATED],
            expected: TRIGGER_ACTIVATED,
        },
        {
            name: 'returns PENDING when all configured are PENDING',
            statuses: [TRIGGER_PENDING, TRIGGER_PENDING],
            expected: TRIGGER_PENDING,
        },
        {
            name: 'returns PENDING when mix of ACTIVATED and PENDING',
            statuses: [TRIGGER_ACTIVATED, TRIGGER_PENDING],
            expected: TRIGGER_PENDING,
        },
        {
            name: 'ignores DISABLED - returns ACTIVATED when remaining is ACTIVATED',
            statuses: [TRIGGER_ACTIVATED, TRIGGER_DISABLED],
            expected: TRIGGER_ACTIVATED,
        },
        {
            name: 'ignores DISABLED - returns PENDING when remaining is PENDING',
            statuses: [TRIGGER_PENDING, TRIGGER_DISABLED],
            expected: TRIGGER_PENDING,
        },
        {
            name: 'returns DISABLED when all DISABLED',
            statuses: [TRIGGER_DISABLED, TRIGGER_DISABLED],
            expected: TRIGGER_DISABLED,
        },
        {
            name: 'single ACTIVATED',
            statuses: [TRIGGER_ACTIVATED],
            expected: TRIGGER_ACTIVATED,
        },
        {
            name: 'single PENDING',
            statuses: [TRIGGER_PENDING],
            expected: TRIGGER_PENDING,
        },
        {
            name: 'single DISABLED',
            statuses: [TRIGGER_DISABLED],
            expected: TRIGGER_DISABLED,
        },
        {
            name: 'empty matchers returns DISABLED',
            statuses: [],
            expected: TRIGGER_DISABLED,
        },
    ])('$name', ({ statuses, expected }) => {
        const matchers = statuses.map((s) => new StubMatcher<string, TriggerStatus>(s))
        const and = new AndTriggerMatching(matchers)
        expect(and.matches('session-123')).toBe(expected)
    })
})
