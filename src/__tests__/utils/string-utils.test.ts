import { truncateString } from '../../utils/string-utils'

describe('string-utils', () => {
    it.each([
        // Basic string truncation without suffix
        ['hello world', 5, undefined, 'hello'],

        // Basic string truncation without suffix
        ['hello world   ', 15, undefined, 'hello world'],

        // String with surrogate pair (emoji)
        ['hello 😄 world', 7, undefined, 'hello 😄'],

        // String with surrogate pair, truncated in the middle of the emoji
        ['hello 😄 world', 6, undefined, 'hello'],

        // Truncation with a suffix added
        ['hello world', 5, '...', 'he...'],

        // Handling whitespace and suffix
        ['   hello world   ', 7, '...', 'hell...'],

        // Empty string with suffix
        ['', 5, '-', ''],

        // invalid input string with suffix
        [null, 5, '-', ''],

        // Truncation without a suffix and with an emoji
        ['hello 😄 world', 8, undefined, 'hello 😄'],
    ])(
        'should truncate string "%s" to max length %d with suffix "%s" and return "%s"',
        (input: string, maxLength: number, suffix: string | undefined, expected: string) => {
            expect(truncateString(input, maxLength, suffix)).toEqual(expected)
        }
    )
})
