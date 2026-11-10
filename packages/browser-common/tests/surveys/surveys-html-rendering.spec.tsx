// @vitest-environment jsdom
import '../helpers/surveys-setup'
import DOMPurify from 'dompurify'
import { h } from 'preact'
import { cleanup, render } from '@testing-library/preact'
import { QuestionHeader } from '../../src/surveys/components/QuestionHeader'
import { IntroScreen } from '../../src/surveys/components/IntroScreen'
import { ConfirmationMessage } from '../../src/surveys/components/ConfirmationMessage'
import { renderChildrenAsTextOrHtml } from '../../src/surveys/surveys-extension-utils'
import { SurveyQuestionType } from '../../src/survey-constants'
import type { SurveyQuestionDescriptionContentType } from '../../src/types/surveys'

const descriptionRenderers = [
    {
        name: 'QuestionHeader',
        render: (description: string, contentType?: SurveyQuestionDescriptionContentType, forceDisableHtml = false) =>
            h(QuestionHeader, {
                question: {
                    question: 'Question',
                    type: SurveyQuestionType.Open,
                    description,
                    descriptionContentType: contentType,
                },
                forceDisableHtml,
            }),
        selector: '.survey-question-description',
    },
    {
        name: 'IntroScreen',
        render: (description: string, contentType?: SurveyQuestionDescriptionContentType, forceDisableHtml = false) =>
            h(IntroScreen, {
                header: 'Welcome',
                description,
                contentType,
                forceDisableHtml,
                appearance: {},
                onStart: () => {},
            }),
        selector: '.intro-screen-body',
    },
    {
        name: 'ConfirmationMessage',
        render: (description: string, contentType?: SurveyQuestionDescriptionContentType, forceDisableHtml = false) =>
            h(ConfirmationMessage, {
                header: 'Thank you',
                description,
                contentType,
                forceDisableHtml,
                appearance: {},
                onClose: () => {},
            }),
        selector: '.thank-you-message-body',
    },
]

const unsafeDescriptions: [string, string][] = [
    ['event attributes', '<img src="/missing.png" onerror="window.__surveyXss = true"><b onclick="alert(1)">Text</b>'],
    [
        'active link URLs',
        '<a href="javascript:alert(1)">Text</a><a href="data:text/html,<script>alert(1)</script>">Link</a><a href="vbscript:msgbox(1)">VB</a>',
    ],
    ['encoded active URLs', '<a href="jav&#x61;script:alert(1)">Text</a><a href="java&#10;script:alert(1)">Link</a>'],
    ['active image URLs', '<img src="javascript:alert(1)" onload="alert(1)">'],
    ['SVG', '<svg onload="alert(1)"><a xlink:href="javascript:alert(1)"><text>Text</text></a></svg>'],
    ['MathML', '<math><mtext><img src="/missing.png" onerror="alert(1)"></mtext></math>'],
    ['iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>" src="javascript:alert(1)"></iframe>'],
    ['script and object', '<script>alert(1)</script><object data="javascript:alert(1)"></object><embed src="/active">'],
    ['document-wide styles', '<p>Rate us</p><style>body{display:none}</style>'],
    [
        'media outside the backend allowlist',
        '<video controls src="/video.mp4"><source src="/video.webm"><track src="/captions.vtt"></video>' +
            '<audio controls src="/audio.mp3"></audio>',
    ],
    [
        'form controls',
        '<p>Rate us</p><form action="https://evil.example/c"><input type="password">' +
            '<button>Send</button><textarea>Secret</textarea><select><option>Choice</option></select></form>',
    ],
    [
        'malformed markup',
        '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
    ],
]

afterEach(cleanup)

describe.each(descriptionRenderers)('$name description HTML boundary', ({ render: renderDescription, selector }) => {
    describe.each(['html', undefined] as const)('content type %s', (contentType) => {
        test.each(unsafeDescriptions)('sanitizes %s', (_, description) => {
            const { container } = render(renderDescription(description, contentType))
            const body = container.querySelector(selector)!
            expect(
                body.querySelector(
                    'script, iframe, object, embed, svg, math, style, form, input, button, textarea, select, video, audio, source, track'
                )
            ).toBeNull()
            for (const element of body.querySelectorAll('*')) {
                for (const attr of element.attributes) {
                    expect(attr.name).not.toMatch(/^on|^srcdoc$|^xlink:/i)
                    if (attr.name === 'href' || attr.name === 'src') {
                        expect(attr.value.replace(/\s/g, '')).not.toMatch(/^(javascript:|vbscript:|data:text\/html)/i)
                    }
                }
            }
        })

        test('preserves benign rich text, styling, links and images', () => {
            const description =
                '<h3>Heading</h3><p><strong>Bold</strong> <em>Emphasis</em> <u>Underline</u><br>' +
                '<span style="color: red">Color</span></p><ul><li>Item</li></ul><blockquote>Quote</blockquote>' +
                '<a href="https://example.com/help" target="_blank" rel="noopener noreferrer">Help</a>' +
                '<a href="/relative" rel="noopener">Relative</a><a href="#details" rel="noopener">Details</a>' +
                '<a href="mailto:help@example.com" rel="noopener">Email</a>' +
                '<img src="https://example.com/image.png" alt="Example" width="100">'
            const { container } = render(renderDescription(description, contentType))
            expect(container.querySelector(selector)!.innerHTML).toBe(description)
        })

        test.each(['', 'noopener', 'noreferrer', 'nofollow'])('preserves new-tab links with rel="%s" safely', (rel) => {
            const description = `<a href="https://example.com/help" target="_blank" rel="${rel}">Help</a>`
            const { container } = render(renderDescription(description, contentType))
            const link = container.querySelector(`${selector} a`)!

            expect(link.getAttribute('target')).toBe('_blank')
            expect(link.getAttribute('href')).toBe('https://example.com/help')
            expect(link.getAttribute('rel')!.split(/\s+/)).toEqual(
                expect.arrayContaining(['noopener', ...(rel ? [rel] : [])])
            )
            expect(link.getAttribute('rel')!.split(/\s+/).includes('noreferrer')).toBe(rel === 'noreferrer')
        })

        test('keeps sanitizing active URLs on new-tab links', () => {
            const { container } = render(
                renderDescription(
                    '<a href="javascript:alert(1)" target="_blank" onclick="alert(1)">Help</a>',
                    contentType
                )
            )
            const link = container.querySelector(`${selector} a`)!

            expect(link.getAttribute('target')).toBe('_blank')
            expect(link.hasAttribute('href')).toBe(false)
            expect(link.hasAttribute('onclick')).toBe(false)
            expect(link.getAttribute('rel')).toBe('noopener')
        })

        test.each(['_self', '_parent', '_top', 'survey-help'])(
            'preserves the backend-supported target %s',
            (target) => {
                const { container } = render(
                    renderDescription(`<a href="https://example.com/help" target="${target}">Help</a>`, contentType)
                )
                const link = container.querySelector(`${selector} a`)!
                expect(link.getAttribute('target')).toBe(target)
                expect(link.getAttribute('href')).toBe('https://example.com/help')
                expect(link.getAttribute('rel')).toBe('noopener')
            }
        )

        test('removes attributes outside the backend allowlist, including DOM-clobbering names', () => {
            const { container } = render(
                renderDescription(
                    '<span id="survey-host" name="surveyHost" class="host-style" data-secret="value" ' +
                        'aria-label="Host" style="color: red" lang="en" title="Help" width="100" height="20">Text</span>' +
                        '<a href="https://example.com" id="survey-link" name="surveyLink">Link</a>' +
                        '<img src="/image.png" id="survey-image" name="surveyImage" alt="Example">',
                    contentType
                )
            )
            const body = container.querySelector(selector)!
            expect(body.querySelector('[id], [name], [class], [data-secret], [aria-label]')).toBeNull()
            const span = body.querySelector('span')!
            expect(span.getAttribute('style')).toBe('color: red')
            expect(span.getAttribute('lang')).toBe('en')
            expect(span.getAttribute('title')).toBe('Help')
            expect(span.getAttribute('width')).toBe('100')
            expect(span.getAttribute('height')).toBe('20')
        })

        test('restricts attributes to the backend-approved element types', () => {
            const { container } = render(
                renderDescription(
                    '<span href="https://example.com" src="/image.png" alt="Unexpected" dir="rtl">Text</span>' +
                        '<bdo dir="rtl">Direction</bdo><a href="/help" hreflang="en">Help</a>' +
                        '<img src="/image.png" alt="Example" align="left">' +
                        '<table border="1" cellpadding="2" bgcolor="#ffffff"><tbody><tr align="left">' +
                        '<td colspan="2" scope="row">Value</td></tr></tbody></table>',
                    contentType
                )
            )
            const body = container.querySelector(selector)!
            expect(body.querySelector('span')!.attributes).toHaveLength(0)
            expect(body.querySelector('bdo')!.getAttribute('dir')).toBe('rtl')
            expect(body.querySelector('a')!.getAttribute('hreflang')).toBe('en')
            expect(body.querySelector('img')!.getAttribute('alt')).toBe('Example')
            expect(body.querySelector('img')!.getAttribute('align')).toBe('left')
            expect(body.querySelector('table')!.getAttribute('cellpadding')).toBe('2')
            expect(body.querySelector('td')!.getAttribute('colspan')).toBe('2')
        })
    })

    test.each([
        ['explicit text', 'text' as const, false],
        ['forced text', 'html' as const, true],
        ['forced text with missing content type', undefined, true],
    ])('keeps %s escaped without interpreting HTML', (_, contentType, forceDisableHtml) => {
        const description = '<strong>Literal</strong><img src=x onerror="alert(1)">'
        const { container } = render(renderDescription(description, contentType, forceDisableHtml))
        const body = container.querySelector(selector)!
        expect(body.textContent).toBe(description)
        expect(body.children).toHaveLength(0)
    })
})

describe('renderChildrenAsTextOrHtml', () => {
    test('renders safely when the host app has configured DOMPurify to return strings', () => {
        DOMPurify.setConfig({})
        try {
            const { container } = render(
                renderChildrenAsTextOrHtml({
                    component: h('div', { className: 'description' }),
                    children: '<strong onclick="alert(1)">Safe</strong>',
                    renderAsHtml: true,
                })
            )

            expect(container.querySelector('.description')!.innerHTML).toBe('<strong>Safe</strong>')
            expect(DOMPurify.sanitize('<em>Host</em>')).toBe('<em>Host</em>')
        } finally {
            DOMPurify.clearConfig()
        }
    })

    test('keeps its policy independent from a permissive host DOMPurify configuration', () => {
        DOMPurify.setConfig({ RETURN_DOM_FRAGMENT: true, ADD_ATTR: ['onclick'] })
        try {
            const { container } = render(
                renderChildrenAsTextOrHtml({
                    component: h('div', { className: 'description' }),
                    children:
                        '<strong onclick="alert(1)">Safe</strong><style>body{display:none}</style>' +
                        '<svg><circle cx="5" cy="5" r="3"></circle></svg>',
                    renderAsHtml: true,
                })
            )

            expect(container.querySelector('.description')!.innerHTML).toBe('<strong>Safe</strong>')
            const hostResult = DOMPurify.sanitize('<strong onclick="alert(1)">Host</strong>', {
                RETURN_DOM_FRAGMENT: true,
            })
            expect(hostResult.querySelector('strong')!.getAttribute('onclick')).toBe('alert(1)')
        } finally {
            DOMPurify.clearConfig()
        }
    })

    test('sanitizes at the shared helper and preserves component properties and style', () => {
        const { container } = render(
            renderChildrenAsTextOrHtml({
                component: h('div', { className: 'description' }),
                children: '<strong onclick="alert(1)">Safe</strong>',
                renderAsHtml: true,
                style: { color: 'red' },
            })
        )
        expect(container.querySelector('.description')!.innerHTML).toBe('<strong>Safe</strong>')
        expect((container.firstElementChild as HTMLElement).style.color).toBe('red')
    })
})
