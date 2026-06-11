import {
    calculateTooltipPosition,
    getSpotlightStyle,
    renderTipTapContent,
    normalizeUrl,
    resolveStepTranslation,
    hasTourWaitPeriodPassed,
} from '../../extensions/product-tours/product-tours-utils'
import { ProductTourStep } from '../../posthog-product-tours-types'
import { doesTourActivateByEvent, doesTourActivateByAction } from '../../utils/product-tour-utils'
import { LAST_SEEN_TOUR_DATE_KEY_PREFIX } from '../../extensions/product-tours/constants'

describe('calculateTooltipPosition', () => {
    const mockWindow = {
        innerWidth: 1024,
        innerHeight: 768,
    }

    beforeEach(() => {
        Object.defineProperty(global, 'window', { value: mockWindow, writable: true })
    })

    const tooltipDimensions = { width: 300, height: 200 }

    it('positions tooltip to the right when space available', () => {
        const targetRect = { top: 300, bottom: 350, left: 100, right: 200, width: 100, height: 50 } as DOMRect
        const result = calculateTooltipPosition(targetRect, tooltipDimensions)

        expect(result.position).toBe('right')
        expect(result.left).toBe(212)
    })

    it('positions tooltip to the left when no space on right', () => {
        const targetRect = { top: 300, bottom: 350, left: 800, right: 900, width: 100, height: 50 } as DOMRect
        const result = calculateTooltipPosition(targetRect, tooltipDimensions)

        expect(result.position).toBe('left')
        expect(result.right).toBe(236)
    })

    it('positions tooltip above when no horizontal space and more space above', () => {
        const targetRect = { top: 600, bottom: 650, left: 150, right: 900, width: 750, height: 50 } as DOMRect
        const result = calculateTooltipPosition(targetRect, tooltipDimensions)

        expect(result.position).toBe('top')
        expect(result.bottom).toBe(180)
    })

    it('positions tooltip below by default', () => {
        const targetRect = { top: 100, bottom: 150, left: 150, right: 900, width: 750, height: 50 } as DOMRect
        const result = calculateTooltipPosition(targetRect, tooltipDimensions)

        expect(result.position).toBe('bottom')
        expect(result.top).toBe(162)
    })

    it('clamps tooltip to viewport and calculates arrow offset', () => {
        const targetRect = { top: 300, bottom: 350, left: 10, right: 60, width: 50, height: 50 } as DOMRect
        const result = calculateTooltipPosition(targetRect, tooltipDimensions)

        expect(result.position).toBe('right')
        expect(typeof result.arrowOffset).toBe('number')
    })
})

describe('getSpotlightStyle', () => {
    it('returns correct style with default padding', () => {
        const targetRect = { top: 100, left: 200, width: 150, height: 50 } as DOMRect
        const style = getSpotlightStyle(targetRect)

        expect(style).toEqual({
            top: '92px',
            left: '192px',
            width: '166px',
            height: '66px',
        })
    })

    it('returns correct style with custom padding', () => {
        const targetRect = { top: 100, left: 200, width: 150, height: 50 } as DOMRect
        const style = getSpotlightStyle(targetRect, 16)

        expect(style).toEqual({
            top: '84px',
            left: '184px',
            width: '182px',
            height: '82px',
        })
    })
})

describe('renderTipTapContent', () => {
    it('returns empty string for null/undefined content', () => {
        expect(renderTipTapContent(null)).toBe('')
        expect(renderTipTapContent(undefined)).toBe('')
    })

    it('escapes plain string content', () => {
        expect(renderTipTapContent('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;')
    })

    it('renders text node', () => {
        const content = { type: 'text', text: 'Hello world' }
        expect(renderTipTapContent(content)).toBe('Hello world')
    })

    it('renders text with bold mark', () => {
        const content = { type: 'text', text: 'Bold text', marks: [{ type: 'bold' }] }
        expect(renderTipTapContent(content)).toBe('<strong>Bold text</strong>')
    })

    it('renders text with italic mark', () => {
        const content = { type: 'text', text: 'Italic text', marks: [{ type: 'italic' }] }
        expect(renderTipTapContent(content)).toBe('<em>Italic text</em>')
    })

    it('renders text with multiple marks', () => {
        const content = { type: 'text', text: 'Bold italic', marks: [{ type: 'bold' }, { type: 'italic' }] }
        expect(renderTipTapContent(content)).toBe('<em><strong>Bold italic</strong></em>')
    })

    it('renders paragraph', () => {
        const content = {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Paragraph text' }],
        }
        expect(renderTipTapContent(content)).toBe('<p>Paragraph text</p>')
    })

    it('renders heading with level', () => {
        const content = {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Heading' }],
        }
        expect(renderTipTapContent(content)).toBe('<h2>Heading</h2>')
    })

    it('renders bullet list', () => {
        const content = {
            type: 'bulletList',
            content: [
                { type: 'listItem', content: [{ type: 'text', text: 'Item 1' }] },
                { type: 'listItem', content: [{ type: 'text', text: 'Item 2' }] },
            ],
        }
        expect(renderTipTapContent(content)).toBe('<ul><li>Item 1</li><li>Item 2</li></ul>')
    })

    it('renders ordered list', () => {
        const content = {
            type: 'orderedList',
            content: [
                { type: 'listItem', content: [{ type: 'text', text: 'First' }] },
                { type: 'listItem', content: [{ type: 'text', text: 'Second' }] },
            ],
        }
        expect(renderTipTapContent(content)).toBe('<ol><li>First</li><li>Second</li></ol>')
    })

    it('renders hard break', () => {
        const content = { type: 'hardBreak' }
        expect(renderTipTapContent(content)).toBe('<br>')
    })

    it('renders doc with nested content', () => {
        const content = {
            type: 'doc',
            content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
            ],
        }
        expect(renderTipTapContent(content)).toBe('<p>First paragraph</p><p>Second paragraph</p>')
    })
})

describe('normalizeUrl', () => {
    it('removes trailing slash', () => {
        expect(normalizeUrl('https://example.com/')).toBe('https://example.com')
    })

    it('keeps URL without trailing slash unchanged', () => {
        expect(normalizeUrl('https://example.com')).toBe('https://example.com')
    })

    it('handles URL with path and trailing slash', () => {
        expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path')
    })

    it('handles URL with query string and trailing slash', () => {
        expect(normalizeUrl('https://example.com/?foo=bar')).toBe('https://example.com/?foo=bar')
    })
})

describe('resolveStepTranslation', () => {
    const baseStep: ProductTourStep = {
        id: 'step-1',
        type: 'modal',
        progressionTrigger: 'button',
        content: { type: 'doc', content: [{ type: 'text', text: 'Hello' }] },
        buttons: {
            primary: { text: 'Next', action: 'next_step' },
            secondary: { text: 'Skip', action: 'dismiss' },
        },
        survey: {
            type: 'rating',
            questionText: 'How was it?',
            display: 'emoji',
            scale: 5,
            lowerBoundLabel: 'Bad',
            upperBoundLabel: 'Good',
            submitButtonText: 'Submit',
            backButtonText: 'Back',
        },
        translations: {
            fr: {
                content: { type: 'doc', content: [{ type: 'text', text: 'Bonjour' }] },
                buttons: { primary: { text: 'Suivant' }, secondary: { text: 'Passer' } },
                survey: { questionText: "Comment c'était ?", submitButtonText: 'Envoyer' },
            },
        },
    }

    it.each([
        ['null lang', null, {}],
        ['empty string lang', '', {}],
        ['missing lang', 'de', {}],
        ['no base match', 'de-AT', {}],
        ['no translations on step', 'fr', { translations: undefined }],
    ])('returns step unchanged for %s', (_label, lang, overrides) => {
        const step = { ...baseStep, ...overrides }
        expect(resolveStepTranslation(step, lang as string | null)).toBe(step)
    })

    it.each([
        ['exact match', 'fr'],
        ['base language fallback', 'fr-FR'],
    ])('resolves translation via %s', (_label, lang) => {
        const result = resolveStepTranslation(baseStep, lang)

        // translated fields
        expect(result.content).toEqual({ type: 'doc', content: [{ type: 'text', text: 'Bonjour' }] })
        expect(result.buttons?.primary).toEqual({ text: 'Suivant', action: 'next_step' })
        expect(result.buttons?.secondary).toEqual({ text: 'Passer', action: 'dismiss' })
        expect(result.survey?.questionText).toBe("Comment c'était ?")
        expect(result.survey?.submitButtonText).toBe('Envoyer')

        // non-translated fields preserved
        expect(result.survey?.scale).toBe(5)
        expect(result.id).toBe('step-1')
    })

    it('does not mutate the original step', () => {
        resolveStepTranslation(baseStep, 'fr')
        expect(baseStep.buttons?.primary?.text).toBe('Next')
        expect(baseStep.survey?.questionText).toBe('How was it?')
    })

    it.each([
        ['buttons', { buttons: undefined }, (r: ProductTourStep) => r.buttons],
        ['survey', { survey: undefined }, (r: ProductTourStep) => r.survey],
    ])('skips %s translation when step has no %s', (_label, overrides, accessor) => {
        const result = resolveStepTranslation({ ...baseStep, ...overrides }, 'fr')
        expect(accessor(result)).toBeUndefined()
    })
})

describe('doesTourActivateByEvent', () => {
    it('returns true when tour has event conditions', () => {
        const tour = {
            conditions: {
                events: { values: [{ name: 'some_event' }] },
            },
        }
        expect(doesTourActivateByEvent(tour)).toBe(true)
    })

    it('returns false when tour has no event conditions', () => {
        const tour = { conditions: {} }
        expect(doesTourActivateByEvent(tour)).toBe(false)
    })

    it('returns false when events array is empty', () => {
        const tour = {
            conditions: {
                events: { values: [] },
            },
        }
        expect(doesTourActivateByEvent(tour)).toBe(false)
    })

    it('returns false when no conditions', () => {
        const tour = {}
        expect(doesTourActivateByEvent(tour)).toBe(false)
    })
})

describe('doesTourActivateByAction', () => {
    it('returns true when tour has action conditions', () => {
        const tour = {
            conditions: {
                actions: { values: [{ id: 1, name: 'some_action' }] },
            },
        }
        expect(doesTourActivateByAction(tour)).toBe(true)
    })

    it('returns false when tour has no action conditions', () => {
        const tour = { conditions: {} }
        expect(doesTourActivateByAction(tour)).toBe(false)
    })

    it('returns false when actions array is empty', () => {
        const tour = {
            conditions: {
                actions: { values: [] },
            },
        }
        expect(doesTourActivateByAction(tour)).toBe(false)
    })

    it('returns false when no conditions', () => {
        const tour = {}
        expect(doesTourActivateByAction(tour)).toBe(false)
    })
})

describe('hasTourWaitPeriodPassed', () => {
    beforeEach(() => localStorage.clear())

    const setLastSeen = (type: string, daysAgo: number) => {
        const date = new Date()
        date.setDate(date.getDate() - daysAgo)
        localStorage.setItem(`${LAST_SEEN_TOUR_DATE_KEY_PREFIX}${type}`, JSON.stringify(date.toISOString()))
    }

    it.each([
        ['no config', undefined, true],
        ['days is 0', { days: 0, types: ['tour' as const] }, true],
        ['empty types', { days: 7, types: [] }, true],
        ['no stored date', { days: 7, types: ['tour' as const] }, true],
    ])('returns true when %s', (_desc, config, expected) => {
        expect(hasTourWaitPeriodPassed(config)).toBe(expected)
    })

    it('returns false when within the wait period', () => {
        setLastSeen('tour', 0)
        expect(hasTourWaitPeriodPassed({ days: 7, types: ['tour'] })).toBe(false)
    })

    it('returns true when past the wait period', () => {
        setLastSeen('tour', 10)
        expect(hasTourWaitPeriodPassed({ days: 7, types: ['tour'] })).toBe(true)
    })

    it('ignores types not in the config', () => {
        setLastSeen('announcement', 0)
        expect(hasTourWaitPeriodPassed({ days: 7, types: ['tour'] })).toBe(true)
    })

    it('uses the most recent date across multiple types', () => {
        setLastSeen('tour', 10)
        setLastSeen('announcement', 0)
        expect(hasTourWaitPeriodPassed({ days: 7, types: ['tour', 'announcement'] })).toBe(false)
    })
})
