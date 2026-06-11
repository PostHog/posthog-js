/* eslint-disable compat/compat */
import { render } from '@testing-library/preact'
import '@testing-library/jest-dom'
import { RichContent } from '../../../extensions/conversations/external/components/RichContent'
import { TipTapDoc } from '../../../posthog-conversations-types'

describe('RichContent', () => {
    const defaultProps = {
        content: 'Fallback text',
        isCustomer: false,
        primaryColor: '#1d4ed8',
    }

    describe('URL Sanitization Security', () => {
        describe('blocks dangerous protocols', () => {
            const dangerousUrls = [
                // Basic dangerous protocols
                'javascript:alert(1)',
                'javascript:alert("XSS")',
                'JAVASCRIPT:alert(1)',
                'JavaScript:alert(1)',
                'vbscript:msgbox(1)',
                'VBSCRIPT:msgbox(1)',
                'data:text/html,<script>alert(1)</script>',
                'DATA:text/html,<script>alert(1)</script>',
                'file:///etc/passwd',
                'FILE:///etc/passwd',

                // Protocol with control characters (bypass attempts)
                'java\x00script:alert(1)',
                'java\x01script:alert(1)',
                'java\x09script:alert(1)', // tab
                'java\x0ascript:alert(1)', // newline
                'java\x0dscript:alert(1)', // carriage return
                'java\x1fscript:alert(1)',

                // Protocol with whitespace (bypass attempts)
                'java script:alert(1)',
                'java\tscript:alert(1)',
                'java\nscript:alert(1)',
                'java\rscript:alert(1)',
                'java   script:alert(1)',
                'j a v a s c r i p t:alert(1)',

                // Mixed case with control chars
                'JaVa\x00ScRiPt:alert(1)',

                // Leading whitespace
                '  javascript:alert(1)',
                '\tjavascript:alert(1)',
                '\njavascript:alert(1)',

                // Encoded variations that should still be blocked after cleanup
                'vb\x00script:msgbox(1)',
                'da\x00ta:text/html,test',
                'fi\x00le:///test',

                // DEL character (0x7F) bypass attempts
                'java\x7fscript:alert(1)',
                'javascript\x7f:alert(1)',

                // Zero-width character bypass attempts
                'java\u200bscript:alert(1)', // zero-width space
                'java\u200cscript:alert(1)', // zero-width non-joiner
                'java\u200dscript:alert(1)', // zero-width joiner
                'java\ufeffscript:alert(1)', // byte order mark

                // Unicode whitespace bypass attempts
                'java\u00a0script:alert(1)', // non-breaking space
                'java\u2000script:alert(1)', // en quad
                'java\u2001script:alert(1)', // em quad
                'java\u2002script:alert(1)', // en space
                'java\u2003script:alert(1)', // em space
                'java\u2028script:alert(1)', // line separator
                'java\u2029script:alert(1)', // paragraph separator
            ]

            it.each(dangerousUrls)('should not render link with dangerous URL: %s', (dangerousUrl) => {
                const doc: TipTapDoc = {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: 'Click me',
                                    marks: [{ type: 'link', attrs: { href: dangerousUrl } }],
                                },
                            ],
                        },
                    ],
                }

                const { container } = render(<RichContent {...defaultProps} richContent={doc} />)
                const link = container.querySelector('a')

                // Link should not be rendered for dangerous URLs
                expect(link).toBeNull()
                // But text should still be present
                expect(container.textContent).toContain('Click me')
            })

            it.each(dangerousUrls)('should not render image with dangerous src: %s', (dangerousUrl) => {
                const doc: TipTapDoc = {
                    type: 'doc',
                    content: [
                        {
                            type: 'image',
                            attrs: { src: dangerousUrl, alt: 'test image' },
                        },
                    ],
                }

                const { container } = render(<RichContent {...defaultProps} richContent={doc} />)
                const img = container.querySelector('img')

                // Image should not be rendered for dangerous URLs
                expect(img).toBeNull()
            })
        })

        describe('allows safe protocols', () => {
            const safeUrls = [
                { url: 'https://example.com', protocol: 'https' },
                { url: 'http://example.com', protocol: 'http' },
                { url: 'HTTPS://example.com', protocol: 'HTTPS (uppercase)' },
                { url: 'HTTP://example.com', protocol: 'HTTP (uppercase)' },
                { url: 'mailto:test@example.com', protocol: 'mailto' },
                { url: 'tel:+1234567890', protocol: 'tel' },
            ]

            it.each(safeUrls)('should render link with $protocol URL', ({ url }) => {
                const doc: TipTapDoc = {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: 'Safe link',
                                    marks: [{ type: 'link', attrs: { href: url } }],
                                },
                            ],
                        },
                    ],
                }

                const { container } = render(<RichContent {...defaultProps} richContent={doc} />)
                const link = container.querySelector('a')

                expect(link).not.toBeNull()
                expect(link?.getAttribute('href')).toBe(url)
            })

            it.each(safeUrls)('should render image with $protocol src', ({ url }) => {
                const doc: TipTapDoc = {
                    type: 'doc',
                    content: [
                        {
                            type: 'image',
                            attrs: { src: url, alt: 'test' },
                        },
                    ],
                }

                const { container } = render(<RichContent {...defaultProps} richContent={doc} />)
                const img = container.querySelector('img')

                expect(img).not.toBeNull()
                expect(img?.getAttribute('src')).toBe(url)
            })
        })

        describe('allows relative URLs', () => {
            const relativeUrls = [
                { url: '/path/to/page', description: 'absolute path' },
                { url: './relative/path', description: 'current directory relative' },
                { url: '../parent/path', description: 'parent directory relative' },
                { url: '#anchor', description: 'anchor only' },
                { url: '/path?query=1', description: 'path with query' },
                { url: '/path#section', description: 'path with anchor' },
            ]

            it.each(relativeUrls)('should render link with $description: $url', ({ url }) => {
                const doc: TipTapDoc = {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: 'Relative link',
                                    marks: [{ type: 'link', attrs: { href: url } }],
                                },
                            ],
                        },
                    ],
                }

                const { container } = render(<RichContent {...defaultProps} richContent={doc} />)
                const link = container.querySelector('a')

                expect(link).not.toBeNull()
                expect(link?.getAttribute('href')).toBe(url)
            })
        })

        describe('blocks unknown protocols', () => {
            const unknownUrls = [
                'ftp://example.com',
                'ssh://example.com',
                'custom://example.com',
                'app://deeplink',
                '//example.com', // protocol-relative (blocked for safety)
            ]

            it.each(unknownUrls)('should not render link with unknown protocol: %s', (url) => {
                const doc: TipTapDoc = {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: 'Unknown protocol',
                                    marks: [{ type: 'link', attrs: { href: url } }],
                                },
                            ],
                        },
                    ],
                }

                const { container } = render(<RichContent {...defaultProps} richContent={doc} />)
                const link = container.querySelector('a')

                expect(link).toBeNull()
            })
        })

        describe('handles edge cases', () => {
            it('should not render link with empty href', () => {
                const doc: TipTapDoc = {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: 'Empty link',
                                    marks: [{ type: 'link', attrs: { href: '' } }],
                                },
                            ],
                        },
                    ],
                }

                const { container } = render(<RichContent {...defaultProps} richContent={doc} />)
                const link = container.querySelector('a')

                expect(link).toBeNull()
            })

            it('should not render link with whitespace-only href', () => {
                const doc: TipTapDoc = {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: 'Whitespace link',
                                    marks: [{ type: 'link', attrs: { href: '   ' } }],
                                },
                            ],
                        },
                    ],
                }

                const { container } = render(<RichContent {...defaultProps} richContent={doc} />)
                const link = container.querySelector('a')

                expect(link).toBeNull()
            })

            it('should not render link with null href', () => {
                const doc: TipTapDoc = {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: 'Null link',
                                    marks: [{ type: 'link', attrs: { href: null as unknown as string } }],
                                },
                            ],
                        },
                    ],
                }

                const { container } = render(<RichContent {...defaultProps} richContent={doc} />)
                const link = container.querySelector('a')

                expect(link).toBeNull()
            })

            it('should not render link with undefined href', () => {
                const doc: TipTapDoc = {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: 'Undefined link',
                                    marks: [{ type: 'link', attrs: {} }],
                                },
                            ],
                        },
                    ],
                }

                const { container } = render(<RichContent {...defaultProps} richContent={doc} />)
                const link = container.querySelector('a')

                expect(link).toBeNull()
            })

            it('should not render image with missing src', () => {
                const doc: TipTapDoc = {
                    type: 'doc',
                    content: [
                        {
                            type: 'image',
                            attrs: { alt: 'no src' },
                        },
                    ],
                }

                const { container } = render(<RichContent {...defaultProps} richContent={doc} />)
                const img = container.querySelector('img')

                expect(img).toBeNull()
            })
        })

        describe('link security attributes', () => {
            it('should set rel="noopener noreferrer" on external links', () => {
                const doc: TipTapDoc = {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: 'External link',
                                    marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
                                },
                            ],
                        },
                    ],
                }

                const { container } = render(<RichContent {...defaultProps} richContent={doc} />)
                const link = container.querySelector('a')

                expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
            })

            it('should set target="_blank" on links', () => {
                const doc: TipTapDoc = {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: 'External link',
                                    marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
                                },
                            ],
                        },
                    ],
                }

                const { container } = render(<RichContent {...defaultProps} richContent={doc} />)
                const link = container.querySelector('a')

                expect(link?.getAttribute('target')).toBe('_blank')
            })

            it('should set referrerPolicy="no-referrer" on links', () => {
                const doc: TipTapDoc = {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: 'External link',
                                    marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
                                },
                            ],
                        },
                    ],
                }

                const { container } = render(<RichContent {...defaultProps} richContent={doc} />)
                const link = container.querySelector('a')

                expect(link?.getAttribute('referrerpolicy')).toBe('no-referrer')
            })
        })
    })

    describe('Recursion Depth Protection', () => {
        it('should handle deeply nested content without crashing', () => {
            // Create a document with 25 levels of nesting (beyond MAX_DEPTH of 20)
            let content: TipTapDoc['content'] = [{ type: 'text', text: 'Deep content' }]

            for (let i = 0; i < 25; i++) {
                content = [{ type: 'paragraph', content }]
            }

            const doc: TipTapDoc = {
                type: 'doc',
                content,
            }

            // Should not throw and should render gracefully
            expect(() => {
                render(<RichContent {...defaultProps} richContent={doc} />)
            }).not.toThrow()
        })

        it('should stop rendering at MAX_DEPTH', () => {
            // Create nested structure that exceeds depth limit
            let content: TipTapDoc['content'] = [{ type: 'text', text: 'Should not appear' }]

            for (let i = 0; i < 25; i++) {
                content = [{ type: 'paragraph', content }]
            }

            const doc: TipTapDoc = {
                type: 'doc',
                content,
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            // Content beyond depth should not be rendered
            expect(container.textContent).not.toContain('Should not appear')
        })
    })

    describe('Input Validation', () => {
        it('should fall back to plain text for invalid richContent', () => {
            const invalidDoc = { invalid: 'structure' } as unknown as TipTapDoc

            const { container } = render(
                <RichContent {...defaultProps} content="Fallback text" richContent={invalidDoc} />
            )

            expect(container.textContent).toBe('Fallback text')
        })

        it('should fall back to plain text when richContent type is not "doc"', () => {
            const invalidDoc: TipTapDoc = {
                type: 'paragraph' as 'doc', // wrong type
                content: [{ type: 'text', text: 'Should not render' }],
            }

            const { container } = render(
                <RichContent {...defaultProps} content="Fallback text" richContent={invalidDoc} />
            )

            expect(container.textContent).toBe('Fallback text')
        })

        it('should fall back to plain text when richContent is null', () => {
            const { container } = render(
                <RichContent {...defaultProps} content="Fallback text" richContent={null as unknown as TipTapDoc} />
            )

            expect(container.textContent).toBe('Fallback text')
        })

        it('should render empty when content is empty and no richContent', () => {
            const { container } = render(<RichContent {...defaultProps} content="" />)

            expect(container.textContent).toBe('')
        })
    })

    describe('Text Content Rendering', () => {
        it('should render plain text with line breaks', () => {
            const { container } = render(<RichContent {...defaultProps} content={'Line 1\nLine 2\nLine 3'} />)

            // Text content should contain all lines
            expect(container.textContent).toContain('Line 1')
            expect(container.textContent).toContain('Line 2')
            expect(container.textContent).toContain('Line 3')
            // Should have 2 br elements for 3 lines
            expect(container.querySelectorAll('br')).toHaveLength(2)
        })

        it('should escape HTML in plain text content', () => {
            const { container } = render(<RichContent {...defaultProps} content="<script>alert(1)</script>" />)

            // Should render as text, not execute script
            expect(container.textContent).toContain('<script>')
            expect(container.querySelector('script')).toBeNull()
        })

        it('should escape HTML in rich text content', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: '<script>alert(1)</script>',
                            },
                        ],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            // Should render as text, not execute script
            expect(container.textContent).toContain('<script>')
            expect(container.querySelector('script')).toBeNull()
        })
    })

    describe('Rich Content Rendering', () => {
        it('should render paragraph', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Hello world' }],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            expect(container.querySelector('p')).not.toBeNull()
            expect(container.textContent).toBe('Hello world')
        })

        it('should render bold text', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Bold text',
                                marks: [{ type: 'bold' }],
                            },
                        ],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            expect(container.querySelector('strong')).not.toBeNull()
        })

        it('should render italic text', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Italic text',
                                marks: [{ type: 'italic' }],
                            },
                        ],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            expect(container.querySelector('em')).not.toBeNull()
        })

        it('should render underline text', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Underlined text',
                                marks: [{ type: 'underline' }],
                            },
                        ],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            expect(container.querySelector('u')).not.toBeNull()
        })

        it('should render strikethrough text', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Strikethrough text',
                                marks: [{ type: 'strike' }],
                            },
                        ],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            expect(container.querySelector('s')).not.toBeNull()
        })

        it('should render inline code', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'const x = 1',
                                marks: [{ type: 'code' }],
                            },
                        ],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            const code = container.querySelector('code')
            expect(code).not.toBeNull()
            expect(code?.textContent).toBe('const x = 1')
        })

        it('should render code block', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'codeBlock',
                        content: [{ type: 'text', text: 'function hello() {\n  return "world"\n}' }],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            expect(container.querySelector('pre')).not.toBeNull()
            expect(container.querySelector('pre code')).not.toBeNull()
        })

        it('should render bullet list', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'bulletList',
                        content: [
                            {
                                type: 'listItem',
                                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 1' }] }],
                            },
                            {
                                type: 'listItem',
                                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 2' }] }],
                            },
                        ],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            expect(container.querySelector('ul')).not.toBeNull()
            expect(container.querySelectorAll('li')).toHaveLength(2)
        })

        it('should render ordered list', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'orderedList',
                        content: [
                            {
                                type: 'listItem',
                                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }],
                            },
                            {
                                type: 'listItem',
                                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }],
                            },
                        ],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            expect(container.querySelector('ol')).not.toBeNull()
            expect(container.querySelectorAll('li')).toHaveLength(2)
        })

        it('should render blockquote', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'blockquote',
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quoted text' }] }],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            expect(container.querySelector('blockquote')).not.toBeNull()
        })

        it('should render headings with correct level', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'heading',
                        attrs: { level: 1 },
                        content: [{ type: 'text', text: 'Heading 1' }],
                    },
                    {
                        type: 'heading',
                        attrs: { level: 3 },
                        content: [{ type: 'text', text: 'Heading 3' }],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            expect(container.querySelector('h1')).not.toBeNull()
            expect(container.querySelector('h3')).not.toBeNull()
        })

        it('should clamp heading level to valid range (1-6)', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'heading',
                        attrs: { level: 0 }, // Invalid, should clamp to 1
                        content: [{ type: 'text', text: 'Clamped heading' }],
                    },
                    {
                        type: 'heading',
                        attrs: { level: 10 }, // Invalid, should clamp to 6
                        content: [{ type: 'text', text: 'Clamped heading 2' }],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            expect(container.querySelector('h1')).not.toBeNull()
            expect(container.querySelector('h6')).not.toBeNull()
        })

        it('should render horizontal rule', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
                    { type: 'horizontalRule' },
                    { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            expect(container.querySelector('hr')).not.toBeNull()
        })

        it('should render hard break', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            { type: 'text', text: 'Line 1' },
                            { type: 'hardBreak' },
                            { type: 'text', text: 'Line 2' },
                        ],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            expect(container.querySelectorAll('br')).toHaveLength(1)
        })

        it('should render image with safe URL', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'image',
                        attrs: { src: 'https://example.com/image.png', alt: 'Test image' },
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            const img = container.querySelector('img')
            expect(img).not.toBeNull()
            expect(img?.getAttribute('src')).toBe('https://example.com/image.png')
            expect(img?.getAttribute('alt')).toBe('Test image')
        })

        it('should render empty paragraph with br', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            const p = container.querySelector('p')
            expect(p).not.toBeNull()
            expect(p?.querySelector('br')).not.toBeNull()
        })

        it('should handle multiple marks on same text', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Bold and italic',
                                marks: [{ type: 'bold' }, { type: 'italic' }],
                            },
                        ],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            expect(container.querySelector('strong')).not.toBeNull()
            expect(container.querySelector('em')).not.toBeNull()
        })

        it('should ignore unknown mark types', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Unknown mark',
                                marks: [{ type: 'unknownMark' as 'bold' }],
                            },
                        ],
                    },
                ],
            }

            // Should not throw
            expect(() => {
                render(<RichContent {...defaultProps} richContent={doc} />)
            }).not.toThrow()
        })

        it('should render unknown node types with children', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'unknownNode' as 'paragraph',
                        content: [{ type: 'text', text: 'Inside unknown' }],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} richContent={doc} />)

            // Should still render the text content
            expect(container.textContent).toContain('Inside unknown')
        })
    })

    describe('Styling', () => {
        it('should apply customer styling when isCustomer is true', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'code',
                                marks: [{ type: 'code' }],
                            },
                        ],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} isCustomer={true} richContent={doc} />)

            const code = container.querySelector('code')
            // Customer styling uses lighter background
            expect(code?.style.background).toContain('rgba(255, 255, 255')
        })

        it('should apply non-customer styling when isCustomer is false', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'code',
                                marks: [{ type: 'code' }],
                            },
                        ],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} isCustomer={false} richContent={doc} />)

            const code = container.querySelector('code')
            // Non-customer styling uses darker background
            expect(code?.style.background).toContain('rgba(0, 0, 0')
        })

        it('should use primaryColor for links when not customer', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Link',
                                marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
                            },
                        ],
                    },
                ],
            }

            const primaryColor = '#ff0000'
            const { container } = render(
                <RichContent {...defaultProps} isCustomer={false} primaryColor={primaryColor} richContent={doc} />
            )

            const link = container.querySelector('a')
            expect(link?.style.color).toBe('rgb(255, 0, 0)')
        })

        it('should use white for links when customer', () => {
            const doc: TipTapDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Link',
                                marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
                            },
                        ],
                    },
                ],
            }

            const { container } = render(<RichContent {...defaultProps} isCustomer={true} richContent={doc} />)

            const link = container.querySelector('a')
            expect(link?.style.color).toBe('white')
        })
    })

    describe('Error Handling', () => {
        it('should gracefully handle errors during rendering and fall back to plain text', () => {
            // Create a doc that might cause issues during rendering
            const problematicDoc = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: null, // Invalid - content should be array
                    },
                ],
            } as unknown as TipTapDoc

            // Should not throw and should fall back to plain text
            expect(() => {
                render(<RichContent {...defaultProps} content="Fallback" richContent={problematicDoc} />)
            }).not.toThrow()
        })
    })
})
