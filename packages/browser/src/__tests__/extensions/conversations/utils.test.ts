import {
    stripMarkdown,
    truncateText,
    formatRelativeTime,
} from '../../../extensions/conversations/external/components/utils'

describe('conversations utils', () => {
    describe('stripMarkdown', () => {
        it('should return empty string for undefined input', () => {
            expect(stripMarkdown(undefined)).toBe('')
        })

        it('should return empty string for empty string input', () => {
            expect(stripMarkdown('')).toBe('')
        })

        it('should return plain text unchanged', () => {
            expect(stripMarkdown('Hello world')).toBe('Hello world')
        })

        describe('headers', () => {
            it('should strip h1 headers', () => {
                expect(stripMarkdown('# Header 1')).toBe('Header 1')
            })

            it('should strip h2 headers', () => {
                expect(stripMarkdown('## Header 2')).toBe('Header 2')
            })

            it('should strip h6 headers', () => {
                expect(stripMarkdown('###### Header 6')).toBe('Header 6')
            })

            it('should strip headers with text after', () => {
                expect(stripMarkdown('# Title\nSome content')).toBe('Title\nSome content')
            })
        })

        describe('bold and italic', () => {
            it('should strip bold with asterisks', () => {
                expect(stripMarkdown('This is **bold** text')).toBe('This is bold text')
            })

            it('should strip bold with underscores', () => {
                expect(stripMarkdown('This is __bold__ text')).toBe('This is bold text')
            })

            it('should strip italic with asterisks', () => {
                expect(stripMarkdown('This is *italic* text')).toBe('This is italic text')
            })

            it('should strip italic with underscores', () => {
                expect(stripMarkdown('This is _italic_ text')).toBe('This is italic text')
            })

            it('should strip nested bold and italic', () => {
                expect(stripMarkdown('This is ***bold and italic*** text')).toBe('This is bold and italic text')
            })
        })

        describe('strikethrough', () => {
            it('should strip strikethrough', () => {
                expect(stripMarkdown('This is ~~deleted~~ text')).toBe('This is deleted text')
            })
        })

        describe('links', () => {
            it('should convert links to just text', () => {
                expect(stripMarkdown('Check [this link](https://example.com)')).toBe('Check this link')
            })

            it('should handle links with complex URLs', () => {
                expect(stripMarkdown('[Click here](https://example.com/path?query=1&foo=bar)')).toBe('Click here')
            })

            it('should handle multiple links', () => {
                expect(stripMarkdown('[Link 1](url1) and [Link 2](url2)')).toBe('Link 1 and Link 2')
            })
        })

        describe('images', () => {
            it('should remove images completely', () => {
                expect(stripMarkdown('Text ![alt text](image.png) more text')).toBe('Text  more text')
            })

            it('should remove images with empty alt text', () => {
                expect(stripMarkdown('![](image.png)')).toBe('')
            })
        })

        describe('code', () => {
            it('should strip inline code backticks', () => {
                expect(stripMarkdown('Use `console.log()` to debug')).toBe('Use console.log() to debug')
            })

            it('should remove code blocks', () => {
                expect(stripMarkdown('```javascript\nconst x = 1;\n```')).toBe('')
            })

            it('should remove code blocks with content around', () => {
                expect(stripMarkdown('Before\n```\ncode\n```\nAfter')).toBe('Before\nAfter')
            })
        })

        describe('blockquotes', () => {
            it('should strip blockquote markers', () => {
                expect(stripMarkdown('> This is a quote')).toBe('This is a quote')
            })

            it('should handle nested blockquotes', () => {
                // Each > at start of line is stripped, so "> >" becomes " " (space remains from second >)
                expect(stripMarkdown('> First level\n> > Nested')).toBe('First level\n Nested')
            })
        })

        describe('horizontal rules', () => {
            it('should remove horizontal rules with dashes', () => {
                expect(stripMarkdown('Above\n---\nBelow')).toBe('Above\nBelow')
            })

            it('should remove horizontal rules with asterisks', () => {
                expect(stripMarkdown('Above\n***\nBelow')).toBe('Above\nBelow')
            })

            it('should remove horizontal rules with underscores', () => {
                expect(stripMarkdown('Above\n___\nBelow')).toBe('Above\nBelow')
            })
        })

        describe('lists', () => {
            it('should strip unordered list markers with dash', () => {
                expect(stripMarkdown('- Item 1\n- Item 2')).toBe('Item 1\nItem 2')
            })

            it('should strip unordered list markers with asterisk', () => {
                expect(stripMarkdown('* Item 1\n* Item 2')).toBe('Item 1\nItem 2')
            })

            it('should strip unordered list markers with plus', () => {
                expect(stripMarkdown('+ Item 1\n+ Item 2')).toBe('Item 1\nItem 2')
            })

            it('should strip ordered list markers', () => {
                expect(stripMarkdown('1. First\n2. Second\n3. Third')).toBe('First\nSecond\nThird')
            })

            it('should handle indented list items', () => {
                expect(stripMarkdown('  - Nested item')).toBe('Nested item')
            })
        })

        describe('HTML tags', () => {
            it('should remove HTML tags', () => {
                expect(stripMarkdown('Text with <strong>HTML</strong> tags')).toBe('Text with strongHTML/strong tags')
            })

            it('should remove self-closing tags', () => {
                expect(stripMarkdown('Line<br/>break')).toBe('Linebr/break')
            })

            it('should remove tags with attributes', () => {
                expect(stripMarkdown('<a href="url">Link</a>')).toBe('a href="url"Link/a')
            })

            it('should remove incomplete/partial tags for security', () => {
                expect(stripMarkdown('<script')).toBe('script')
                expect(stripMarkdown('text<script>alert(1)')).toBe('textscriptalert(1)')
            })

            it('should remove lone angle brackets', () => {
                expect(stripMarkdown('a < b > c')).toBe('a  b  c')
            })
        })

        describe('whitespace handling', () => {
            it('should collapse multiple newlines', () => {
                expect(stripMarkdown('Line 1\n\n\n\nLine 2')).toBe('Line 1\nLine 2')
            })

            it('should trim leading and trailing whitespace', () => {
                expect(stripMarkdown('  text with spaces  ')).toBe('text with spaces')
            })
        })

        describe('combined markdown', () => {
            it('should handle complex markdown', () => {
                const markdown = `# Welcome

This is **bold** and *italic* text with a [link](https://example.com).

- Item 1
- Item 2

\`\`\`
code block
\`\`\`

> A quote

Done!`

                const expected = `Welcome
This is bold and italic text with a link.
Item 1
Item 2
A quote
Done!`

                expect(stripMarkdown(markdown)).toBe(expected)
            })

            it('should handle message-like content', () => {
                const markdown = 'Hey! Check out this **new feature** at [our docs](https://docs.example.com) 🎉'
                expect(stripMarkdown(markdown)).toBe('Hey! Check out this new feature at our docs 🎉')
            })
        })
    })

    describe('truncateText', () => {
        it('should return "No messages yet" for undefined input', () => {
            expect(truncateText(undefined, 60)).toBe('No messages yet')
        })

        it('should return "No messages yet" for empty string', () => {
            expect(truncateText('', 60)).toBe('No messages yet')
        })

        it('should return text unchanged if shorter than max length', () => {
            expect(truncateText('Short text', 60)).toBe('Short text')
        })

        it('should return text unchanged if equal to max length', () => {
            const text = 'a'.repeat(60)
            expect(truncateText(text, 60)).toBe(text)
        })

        it('should truncate text longer than max length with ellipsis', () => {
            const text = 'a'.repeat(70)
            const result = truncateText(text, 60)
            expect(result.length).toBe(60)
            expect(result.endsWith('...')).toBe(true)
        })
    })

    describe('formatRelativeTime', () => {
        beforeEach(() => {
            jest.useFakeTimers()
            jest.setSystemTime(new Date('2024-01-15T12:00:00Z'))
        })

        afterEach(() => {
            jest.useRealTimers()
        })

        it('should return empty string for undefined input', () => {
            expect(formatRelativeTime(undefined)).toBe('')
        })

        it('should return "Just now" for times less than a minute ago', () => {
            const now = new Date('2024-01-15T11:59:30Z').toISOString()
            expect(formatRelativeTime(now)).toBe('Just now')
        })

        it('should return minutes ago for times less than an hour ago', () => {
            const thirtyMinsAgo = new Date('2024-01-15T11:30:00Z').toISOString()
            expect(formatRelativeTime(thirtyMinsAgo)).toBe('30m ago')
        })

        it('should return hours ago for times less than a day ago', () => {
            const fiveHoursAgo = new Date('2024-01-15T07:00:00Z').toISOString()
            expect(formatRelativeTime(fiveHoursAgo)).toBe('5h ago')
        })

        it('should return "Yesterday" for times one day ago', () => {
            const yesterday = new Date('2024-01-14T12:00:00Z').toISOString()
            expect(formatRelativeTime(yesterday)).toBe('Yesterday')
        })

        it('should return days ago for times less than a week ago', () => {
            const threeDaysAgo = new Date('2024-01-12T12:00:00Z').toISOString()
            expect(formatRelativeTime(threeDaysAgo)).toBe('3d ago')
        })

        it('should return formatted date for times a week or more ago', () => {
            const twoWeeksAgo = new Date('2024-01-01T12:00:00Z').toISOString()
            const result = formatRelativeTime(twoWeeksAgo)
            expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
        })
    })
})
