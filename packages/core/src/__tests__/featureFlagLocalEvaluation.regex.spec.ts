import { InconclusiveMatchError, matchFeatureFlagProperty } from '../featureFlagLocalEvaluation'

describe('feature flag regex compatibility', () => {
  describe.each(['regex', 'not_regex'])('%s', (operator) => {
    test.each([
      ['inline flags', '(?i)^null$', 'NULL'],
      ['scoped flags', '(?i:^null$)', 'NULL'],
      ['Unicode digits', '^\\d+$', '١'],
      ['Unicode word characters', '^\\w+$', 'é'],
      ['Unicode word boundaries', '\\bé\\b', 'é'],
      ['Unicode whitespace', '^\\s$', '\ufeff'],
      ['Unicode property class', '^\\p{L}+$', 'é'],
      ['Unicode property class with ASCII input', '^\\p{L}+$', 'null'],
      ['Unicode property class with explicit null', '^\\p{L}+$', null],
      ['complement Unicode class', '^\\P{L}+$', '123'],
      ['Rust absolute anchors', '\\Afoo\\z', 'foo'],
      ['Unicode scalar matching', '^.$', '😀'],
      ['carriage-return matching', '^.$', '\r'],
      ['POSIX character class', '^[[:alpha:]]+$', 'foo'],
      ['character class intersection', '^[a-z&&[^aeiou]]+$', 'bcdf'],
      ['empty character class', '[]', 'a'],
      ['negated empty character class', '[^]', 'a'],
      ['octal escape', '\\141', 'a'],
      ['identity escape', '\\q', 'q'],
      ['Rust hexadecimal scalar', '^\\x{41}$', 'A'],
      ['lookahead', 'a(?=b)', 'ab'],
      ['lookbehind', '(?<=a+)b', 'aab'],
      ['backreference', '(a)\\1', 'aa'],
      ['possessive repetition', 'a++', 'aa'],
      ['open-bound repetition', 'a{,2}', 'aa'],
      ['stacked repetition', 'a*{2}', 'aa'],
      ['unescaped literal braces', '{foo}', '{foo}'],
      ['legacy shorthand range start', '[\\s-9]', '-'],
      ['legacy shorthand range end', '[a-\\d]', '-'],
    ])('defers %s instead of guessing a boolean', (_name, pattern, input) => {
      expect(() => matchFeatureFlagProperty({ key: 'key', operator, value: pattern }, { key: input })).toThrow(
        InconclusiveMatchError
      )
    })

    test.each([
      ['plain search', 'pro', 'a pro plan', true],
      ['explicit anchors', '^pro$', 'a pro plan', false],
      ['case-sensitive search', '^pro$', 'PRO', false],
      ['ASCII digits', '^\\d+$', '123', true],
      ['ASCII word characters', '^\\w+$', 'abc_123', true],
      ['ASCII email', '^[\\w.+-]+@example\\.com$', 'a.b+tag@example.com', true],
      ['grouped repetition', '^(?:ab|cd){2,3}$', 'abcdab', true],
      ['escaped Unicode marker', '^\\\\p\\{L\\}$', '\\p{L}', true],
      ['escaped inline flags', '^\\(\\?i\\)$', '(?i)', true],
      ['hexadecimal byte', '^\\x41+$', 'AA', true],
      ['explicit null matching', '^nu', null, true],
      ['escaped literal repetition', '^\\++$', '++', true],
      ['class backspace', '[\\b]', '\b', true],
      ['escaped hyphen', '^a\\-b$', 'a-b', true],
      ['class trailing hyphen', '^[\\w-]+$', 'a-b', true],
      ['empty pattern', '', '', true],
      ['empty pattern with Unicode input', '', 'é', true],
      ['empty pattern with carriage-return input', '', '\r', true],
      ['strict end anchor', '^foo$', 'foo\n', false],
    ] as const)('keeps %s local', (_name, pattern, input, expected) => {
      expect(matchFeatureFlagProperty({ key: 'key', operator, value: pattern }, { key: input })).toBe(
        operator === 'regex' ? expected : !expected
      )
    })

    test.each(['[', '(', '*', '?*'])('keeps invalid portable pattern %p as a no-match', (pattern) => {
      expect(matchFeatureFlagProperty({ key: 'key', operator, value: pattern }, { key: 'value' })).toBe(false)
    })

    test.each(['é', '\r'])('keeps invalid patterns as no-matches for input %p', (input) => {
      expect(matchFeatureFlagProperty({ key: 'key', operator, value: '[' }, { key: input })).toBe(false)
    })

    test('keeps omitted property values inconclusive', () => {
      expect(() => matchFeatureFlagProperty({ key: 'key', operator, value: 'x' }, {})).toThrow(InconclusiveMatchError)
    })

    test('defers regex compilation failures that are not invalid syntax', () => {
      const NativeRegExp = RegExp
      const constructorSpy = vi
        .spyOn(globalThis, 'RegExp')
        .mockImplementation((pattern: string | RegExp, flags?: string) => {
          if (pattern === '^safe$') throw new RangeError('Regex compilation failed')
          return new NativeRegExp(pattern, flags)
        })
      try {
        expect(() => matchFeatureFlagProperty({ key: 'key', operator, value: '^safe$' }, { key: 'safe' })).toThrow(
          InconclusiveMatchError
        )
      } finally {
        constructorSpy.mockRestore()
      }
    })

    test('defers regex execution failures without negating them', () => {
      const nativeTest = RegExp.prototype.test
      const testSpy = vi.spyOn(RegExp.prototype, 'test').mockImplementation(function (this: RegExp, input: string) {
        if (this.source === '^safe$') throw new Error('Regex execution failed')
        return nativeTest.call(this, input)
      })
      try {
        expect(() => matchFeatureFlagProperty({ key: 'key', operator, value: '^safe$' }, { key: 'safe' })).toThrow(
          InconclusiveMatchError
        )
      } finally {
        testSpy.mockRestore()
      }
    })
  })
})
