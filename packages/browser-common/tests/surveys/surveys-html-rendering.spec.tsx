// @vitest-environment jsdom
import '../helpers/surveys-setup'
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
            expect(body.querySelector('script, iframe, object, embed, svg, math, style')).toBeNull()
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
                '<a href="/relative">Relative</a><a href="#details">Details</a><a href="mailto:help@example.com">Email</a>' +
                '<img src="https://example.com/image.png" alt="Example" width="100">'
            const { container } = render(renderDescription(description, contentType))
            // DOMPurify's default HTML policy also removes link targets.
            expect(container.querySelector(selector)!.innerHTML).toBe(description.replace(' target="_blank"', ''))
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
