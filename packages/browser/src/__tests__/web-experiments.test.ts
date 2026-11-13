import type { Mock as VitestMock } from 'vitest'
import DOMPurify from 'dompurify'
import { WebExperiments } from '../web-experiments'
import { defaultConfig, PostHog } from '../posthog-core'
import { PostHogPersistence } from '../posthog-persistence'
import { WebExperiment } from '../web-experiments-types'
import { RequestRouter } from '../utils/request-router'
import { ConsentManager } from '../consent'
import { createMockPostHog, createMockConfig, createMockPersistence } from './helpers/posthog-instance'

const sanitizerMock = vi.hoisted((): { instance?: ReturnType<typeof DOMPurify>; factoryCalls: number } => ({
    factoryCalls: 0,
}))

vi.mock('dompurify', async (importOriginal) => {
    const actual = await importOriginal<{ default: typeof DOMPurify }>()
    const instance = actual.default()
    sanitizerMock.instance = instance
    return {
        ...actual,
        default: Object.assign(() => {
            sanitizerMock.factoryCalls++
            return instance
        }, actual.default),
    }
})

describe('Web Experimentation', () => {
    let webExperiment: WebExperiments
    let posthog: PostHog
    let persistence: PostHogPersistence
    let experimentsResponse: { status?: number; experiments?: WebExperiment[] }

    const signupButtonWebExperimentWithFeatureFlag = {
        id: 3,
        name: 'Signup button test',
        feature_flag_key: 'signup-button-test',
        variants: {
            'variant-sign-up': {
                transforms: [
                    {
                        selector: '#set-user-properties',
                        html: 'Sign me up',
                    },
                ],
            },
            'variant-send-it': {
                transforms: [
                    {
                        selector: '#set-user-properties',
                        html: 'Send it',
                    },
                ],
            },
            'variant-css-transform': {
                transforms: [
                    {
                        selector: '#set-user-properties',
                        css: 'font-size:40px',
                    },
                ],
            },
            'variant-inner-html-transform': {
                transforms: [
                    {
                        selector: '#set-user-properties',
                        html: '<h1>hello world</h1>',
                    },
                ],
            },
            control: {
                transforms: [
                    {
                        selector: '#set-user-properties',
                        html: 'Sign up',
                    },
                ],
            },
        },
    } as unknown as WebExperiment

    const buttonWebExperimentWithUrlConditions = {
        id: 3,
        name: 'Signup button test',
        variants: {
            'variant-sign-up': {
                conditions: {
                    url: 'https://example.com/Signup',
                    urlMatchType: 'exact',
                },
                transforms: [
                    {
                        selector: '#set-user-properties',
                        html: 'Sign me up',
                    },
                ],
            },
            'variant-send-it': {
                conditions: { url: 'regex-url', urlMatchType: 'regex' },
                transforms: [
                    {
                        selector: '#set-user-properties',
                        html: 'Send it',
                    },
                ],
            },
            'variant-icontains': {
                conditions: { url: 'checkout', urlMatchType: 'icontains' },
                transforms: [
                    {
                        selector: '#set-user-properties',
                        html: 'Sign up',
                    },
                ],
            },
            control: {
                transforms: [
                    {
                        selector: '#set-user-properties',
                        html: 'Sign up',
                    },
                ],
            },
        },
    } as unknown as WebExperiment

    const simulateFeatureFlags: VitestMock = vi.fn()

    beforeEach(() => {
        let cachedFlags = {}
        experimentsResponse = { experiments: [] }
        persistence = createMockPersistence({ props: {}, register: vi.fn() })
        posthog = makePostHog({
            config: createMockConfig({
                disable_web_experiments: false,
                api_host: 'https://test.com',
                token: 'testtoken',
                autocapture: true,
            }),
            persistence: persistence,
            get_property: vi.fn(),
            capture: vi.fn(),
            _send_request: vi
                .fn()
                .mockImplementation(({ callback }) => callback({ statusCode: 200, json: experimentsResponse })),
            consent: { isOptedOut: () => true } as unknown as ConsentManager,
            onFeatureFlags: vi.fn(),
            getFeatureFlag: (key: string) => {
                return cachedFlags[key]
            },
        })

        simulateFeatureFlags.mockImplementation((flags) => {
            cachedFlags = flags
            webExperiment.onFeatureFlags(Object.keys(flags))
        })

        posthog.requestRouter = new RequestRouter(posthog)
        webExperiment = new WebExperiments(posthog)
    })

    afterEach(() => {
        vi.restoreAllMocks()
        document.body.innerHTML = ''
        window.history.replaceState({}, '', '/')
    })

    function createTestDocument() {
        const elParent = document.createElement('span')
        elParent.id = 'set-user-properties'
        elParent.innerHTML = 'original'
        document.body.appendChild(elParent)
        return elParent
    }

    function testUrlMatch(testLocation: string, expectedInnerHTML: string) {
        experimentsResponse = {
            experiments: [buttonWebExperimentWithUrlConditions],
        }
        const webExperiment = new WebExperiments(posthog)
        const elParent = createTestDocument()

        vi.spyOn(WebExperiments, 'getWindowLocation').mockReturnValue(new URL(testLocation) as unknown as Location)

        webExperiment.getWebExperimentsAndEvaluateDisplayLogic(false)
        expect(posthog._send_request).toHaveBeenLastCalledWith(
            expect.objectContaining({ method: 'GET', timestampMode: 'query' })
        )
        expect(elParent.innerHTML).toEqual(expectedInnerHTML)
    }

    function assertElementChanged(variant: string, expectedProperty: string, value: string) {
        const elParent = createTestDocument()

        simulateFeatureFlags({
            'signup-button-test': variant,
        })

        switch (expectedProperty) {
            case 'css':
                expect(elParent.getAttribute('style')).toEqual(value)
                break
            case 'innerHTML':
                expect(elParent.innerHTML).toEqual(value)
                break
        }
    }

    it('creates its private sanitizer only for HTML transforms and reuses it', async () => {
        const factoryCalls = sanitizerMock.factoryCalls
        vi.resetModules()
        const { WebExperiments: FreshWebExperiments } = await import('../web-experiments')
        webExperiment = new FreshWebExperiments(posthog)
        experimentsResponse = { experiments: [signupButtonWebExperimentWithFeatureFlag] }
        const element = createTestDocument()
        expect(sanitizerMock.factoryCalls).toBe(factoryCalls)

        simulateFeatureFlags({ 'signup-button-test': 'variant-css-transform' })

        expect(element.innerHTML).toEqual('original')
        expect(element.getAttribute('style')).toEqual('font-size:40px')
        expect(sanitizerMock.factoryCalls).toBe(factoryCalls)

        simulateFeatureFlags({ 'signup-button-test': 'variant-inner-html-transform' })

        expect(element.innerHTML).toEqual('<h1>hello world</h1>')
        expect(sanitizerMock.factoryCalls).toBe(factoryCalls + 1)

        simulateFeatureFlags({ 'signup-button-test': 'variant-sign-up' })

        expect(element.innerHTML).toEqual('Sign me up')
        expect(sanitizerMock.factoryCalls).toBe(factoryCalls + 1)
    })

    describe('bot detection', () => {
        it('does not apply web experiment if viewer is a bot', () => {
            experimentsResponse = {
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }
            const isBot = vi.spyOn(webExperiment, '_is_bot').mockReturnValue(true)
            const elParent = createTestDocument()

            simulateFeatureFlags({
                'signup-button-test': 'variant-sign-up',
            })

            expect(elParent.innerHTML).toEqual('original')
            expect(posthog._send_request).not.toHaveBeenCalled()

            isBot.mockReturnValue(false)
            simulateFeatureFlags({ 'signup-button-test': 'variant-sign-up' })
            expect(elParent.innerHTML).toEqual('Sign me up')
        })
    })

    describe('url match conditions', () => {
        it('exact location match', () => {
            // Should match 'variant-sign-up' -> "Sign me up"
            const testLocation = 'https://example.com/Signup'
            const expectedInnerHTML = 'Sign me up'
            testUrlMatch(testLocation, expectedInnerHTML)
        })

        it('regex location match', () => {
            // Should match 'variant-send-it' -> "Send it"
            const testLocation = 'https://regex-url.com/test'
            const expectedInnerHTML = 'Send it'
            testUrlMatch(testLocation, expectedInnerHTML)
        })

        it('icontains location match', () => {
            // Should match 'variantIcontains' -> "Sign up"
            const testLocation = 'https://example.com/checkout'
            const expectedInnerHTML = 'Sign up'
            testUrlMatch(testLocation, expectedInnerHTML)
        })

        describe('get_current_url override', () => {
            it('matches against the overridden URL, not the raw browser URL', () => {
                experimentsResponse = { experiments: [buttonWebExperimentWithUrlConditions] }
                const webExperiment = new WebExperiments(posthog)
                const elParent = createTestDocument()

                // raw browser URL would not match the exact condition

                vi.spyOn(WebExperiments, 'getWindowLocation').mockReturnValue(
                    new URL('https://generated-host.skin/x') as unknown as Location
                )
                posthog.config.get_current_url = () => 'https://example.com/Signup'

                webExperiment.getWebExperimentsAndEvaluateDisplayLogic(false)
                expect(elParent.innerHTML).toEqual('Sign me up')
            })

            it('does not match when the override rewrites away from the matching URL', () => {
                experimentsResponse = { experiments: [buttonWebExperimentWithUrlConditions] }
                const webExperiment = new WebExperiments(posthog)
                const elParent = createTestDocument()

                vi.spyOn(WebExperiments, 'getWindowLocation').mockReturnValue(
                    new URL('https://example.com/Signup') as unknown as Location
                )
                posthog.config.get_current_url = () => 'https://generated-host.skin/x'

                webExperiment.getWebExperimentsAndEvaluateDisplayLogic(false)
                expect(elParent.innerHTML).toEqual('original')
            })
        })

        describe('experiment running on a feature flag', () => {
            const flaggedExperimentWithUrlConditions = {
                ...buttonWebExperimentWithUrlConditions,
                feature_flag_key: 'signup-button-test',
            } as unknown as WebExperiment

            function applyVariantOnPage(testLocation: string): HTMLElement {
                experimentsResponse = { experiments: [flaggedExperimentWithUrlConditions] }
                const elParent = createTestDocument()
                vi.spyOn(WebExperiments, 'getWindowLocation').mockReturnValue(
                    new URL(testLocation) as unknown as Location
                )
                simulateFeatureFlags({ 'signup-button-test': 'variant-sign-up' })
                return elParent
            }

            it.each([
                ['the page the variant targets', 'https://example.com/Signup', 'Sign me up'],
                ['any other page', 'https://example.com/pricing', 'original'],
            ])('loads the experiment and changes %s', (_pageDescription, testLocation, expectedInnerHTML) => {
                expect(applyVariantOnPage(testLocation).innerHTML).toEqual(expectedInnerHTML)
            })

            it.each([
                ['the page the variant targets', 'https://example.com/Signup', 'Sign me up'],
                ['any other page', 'https://example.com/pricing', 'original'],
            ])(
                'changes %s when the flags arrive again for a loaded experiment',
                (_pageDescription, testLocation, expectedInnerHTML) => {
                    const elParent = applyVariantOnPage(testLocation)
                    elParent.innerHTML = 'original'

                    simulateFeatureFlags({ 'signup-button-test': 'variant-sign-up' })

                    expect(elParent.innerHTML).toEqual(expectedInnerHTML)
                }
            )
        })
    })

    describe('utm match conditions', () => {
        const utm = {
            utm_source: 'newsletter',
            utm_campaign: 'marketing',
            utm_medium: 'desktop',
            utm_term: 'signup',
        }

        beforeEach(() => {
            experimentsResponse = {
                experiments: [
                    {
                        ...buttonWebExperimentWithUrlConditions,
                        variants: {
                            'variant-sign-up': {
                                ...buttonWebExperimentWithUrlConditions.variants['variant-sign-up'],
                                conditions: { utm },
                            },
                        },
                    },
                ],
            }
        })

        it.each(['utm_source', 'utm_campaign', 'utm_medium', 'utm_term'])(
            'disqualifies when %s does not match',
            (key) => {
                const elParent = createTestDocument()
                const params = new URLSearchParams({ ...utm, [key]: 'mismatch' })
                window.history.replaceState({}, '', `/?${params}`)

                webExperiment.getWebExperimentsAndEvaluateDisplayLogic()

                expect(elParent.innerHTML).toEqual('original')
            }
        )

        it('applies the variant when all UTM conditions match', () => {
            const elParent = createTestDocument()
            window.history.replaceState({}, '', `/?${new URLSearchParams(utm)}`)

            webExperiment.getWebExperimentsAndEvaluateDisplayLogic()

            expect(elParent.innerHTML).toEqual('Sign me up')
        })
    })

    describe.each([false, true])('remote HTML with disable_external_dependency_loading=%s', (disabled) => {
        beforeEach(() => {
            posthog.config.disable_external_dependency_loading = disabled
        })

        function setRemoteTransform(html: string, css?: string) {
            experimentsResponse = JSON.parse(
                JSON.stringify({
                    experiments: [
                        {
                            ...signupButtonWebExperimentWithFeatureFlag,
                            variants: {
                                test: {
                                    variant_name: 'test',
                                    transforms: [{ selector: '#set-user-properties', html, css }],
                                },
                            },
                        },
                    ],
                })
            )
        }

        describe.each([
            ['HTML', '<div id="set-user-properties"></div>'],
            ['MathML', '<math><mtext id="set-user-properties"></mtext></math>'],
        ])('%s sanitizer isolation', (_name, fixture) => {
            it('ignores persistent host configuration that returns strings', () => {
                document.body.innerHTML = fixture
                const element = document.querySelector('#set-user-properties')!
                setRemoteTransform('<b onclick="alert(1)">Sale</b>')
                DOMPurify.setConfig({})
                try {
                    simulateFeatureFlags({ 'signup-button-test': 'test' })

                    expect(element.innerHTML).toEqual('<b>Sale</b>')
                    expect(DOMPurify.sanitize('<em>Host</em>')).toEqual('<em>Host</em>')
                } finally {
                    DOMPurify.clearConfig()
                }
            })

            it('ignores permissive host configuration without changing the host policy', () => {
                document.body.innerHTML = fixture
                const element = document.querySelector('#set-user-properties')!
                setRemoteTransform('<b onclick="alert(1)">Sale</b><img src="/missing" onerror="alert(1)">')
                DOMPurify.setConfig({ RETURN_DOM_FRAGMENT: true, ADD_ATTR: ['onclick', 'onerror'] })
                try {
                    simulateFeatureFlags({ 'signup-button-test': 'test' })

                    expect(element.innerHTML).toEqual('<b>Sale</b><img src="/missing">')
                    const hostResult = DOMPurify.sanitize('<b onclick="alert(1)">Host</b>', {
                        RETURN_DOM_FRAGMENT: true,
                    })
                    expect(hostResult.querySelector('b')!.getAttribute('onclick')).toEqual('alert(1)')
                } finally {
                    DOMPurify.clearConfig()
                }
            })
        })

        it('ignores host sanitizer hooks without removing them', () => {
            const element = createTestDocument()
            setRemoteTransform('<b>Sale</b>')
            const hook = vi.fn((node: Element) => {
                if (node.localName === 'b') {
                    node.setAttribute('onclick', 'alert(1)')
                }
            })
            DOMPurify.addHook('afterSanitizeAttributes', hook)
            try {
                simulateFeatureFlags({ 'signup-button-test': 'test' })

                expect(element.innerHTML).toEqual('<b>Sale</b>')
                expect(hook).not.toHaveBeenCalled()
                const hostResult = DOMPurify.sanitize('<b>Host</b>', { RETURN_DOM_FRAGMENT: true })
                expect(hostResult.querySelector('b')!.getAttribute('onclick')).toEqual('alert(1)')
            } finally {
                DOMPurify.removeHook('afterSanitizeAttributes', hook)
            }
        })

        it.each([
            [
                'event handlers',
                '<img src="/missing" onerror="window.__experimentExecuted = true">',
                '<img src="/missing">',
            ],
            ['script tags', '<script>window.__experimentExecuted = true</script><b>Safe</b>', '<b>Safe</b>'],
            ['javascript links', '<a href="javascript:alert(1)">Link</a>', '<a>Link</a>'],
            ['encoded active URLs', '<a href="java&#x09;script:alert(1)">Link</a>', '<a>Link</a>'],
            ['data HTML links', '<a href="data:text/html,<script>alert(1)</script>">Link</a>', '<a>Link</a>'],
            [
                'form action URLs',
                '<form action="javascript:alert(1)"><button formaction="javascript:alert(1)">Go</button></form>',
                '<form><button>Go</button></form>',
            ],
            [
                'SVG handlers and URLs',
                '<svg onload="alert(1)"><a xlink:href="javascript:alert(1)"><text>Link</text></a></svg>',
                '<svg><a><text>Link</text></a></svg>',
            ],
            ['embedded documents', '<iframe srcdoc="<img src=x onerror=alert(1)>"></iframe><b>Safe</b>', '<b>Safe</b>'],
        ])('removes %s from JSON-supplied transforms', (_name, html, expected) => {
            setRemoteTransform(html)
            const element = createTestDocument()

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            expect(posthog._send_request).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://test.com/api/web_experiments/?token=testtoken',
                    method: 'GET',
                })
            )
            expect(element.innerHTML).toEqual(expected)
        })

        it.each([
            ['table', '<table id="set-user-properties"></table>', '<tbody><tr><td>Sale</td></tr></tbody>'],
            ['tbody', '<table><tbody id="set-user-properties"></tbody></table>', '<tr><td>Sale</td></tr>'],
            ['tr', '<table><tbody><tr id="set-user-properties"></tr></tbody></table>', '<td>Sale</td>'],
            ['svg', '<svg id="set-user-properties"></svg>', '<circle cx="10" cy="10" r="5"></circle>'],
            ['g', '<svg><g id="set-user-properties"></g></svg>', '<circle cx="10" cy="10" r="5"></circle>'],
        ])('preserves safe markup in a %s target', (_tag, fixture, html) => {
            document.body.innerHTML = fixture
            const element = document.querySelector('#set-user-properties')!
            setRemoteTransform(html)

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            expect(element.innerHTML).toEqual(html)
            expect(element.firstElementChild?.namespaceURI).toEqual(element.namespaceURI)
        })

        it.each([
            [
                '<table><tbody id="set-user-properties"></tbody></table>',
                '<tr onclick="alert(1)"><td><a href="javascript:alert(1)">Sale</a></td></tr>',
                '<tr><td><a>Sale</a></td></tr>',
            ],
            [
                '<svg id="set-user-properties"></svg>',
                '<circle onload="alert(1)" r="5"></circle><script>alert(1)</script><a href="javascript:alert(1)"><text>Sale</text></a>',
                '<circle r="5"></circle><a><text>Sale</text></a>',
            ],
        ])('sanitizes active markup in contextual targets: %s', (fixture, html, expected) => {
            document.body.innerHTML = fixture
            const element = document.querySelector('#set-user-properties')!
            setRemoteTransform(html)

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            expect(element.innerHTML).toEqual(expected)
        })

        it.each([
            ['<b onclick="alert(1)">Sale</b>', '<b>Sale</b>'],
            ['<script>alert(1)</script>', ''],
        ])('sanitizes once for repeated targets with the same parsing context: %s', (html, expected) => {
            const elements = Array.from({ length: 10 }, () => createTestDocument())
            setRemoteTransform(html)
            const sanitize = vi.spyOn(sanitizerMock.instance!, 'sanitize')

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            expect(elements.map((element) => element.innerHTML)).toEqual(Array(10).fill(expected))
            expect(sanitize).toHaveBeenCalledTimes(1)
        })

        it.each(['foreignObject', 'desc', 'title'])('preserves safe HTML in SVG %s targets', (tag) => {
            document.body.innerHTML = `<svg><${tag} id="set-user-properties"></${tag}></svg>`
            setRemoteTransform('<b onclick="alert(1)">Sale</b>')

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            const element = document.querySelector('#set-user-properties')!
            expect(element.innerHTML).toEqual('<b>Sale</b>')
            expect(element.firstElementChild?.namespaceURI).toEqual('http://www.w3.org/1999/xhtml')
        })

        it.each([
            ['<b>Sale</b>', '<b>Sale</b>'],
            [
                '<b onclick="alert(1)">Sale</b><script>alert(1)</script>' +
                    '<template><img src="/missing" onerror="alert(1)"></template>',
                '<b>Sale</b><template><img src="/missing"></template>',
            ],
        ])('preserves sanitized template content and reuses it: %s', (html, expected) => {
            document.body.innerHTML = '<template id="set-user-properties">Original</template>'.repeat(2)
            setRemoteTransform(html)
            const sanitize = vi.spyOn(sanitizerMock.instance!, 'sanitize')

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            const templates = document.querySelectorAll<HTMLTemplateElement>('#set-user-properties')
            templates.forEach((template) => {
                expect(template.innerHTML).toEqual(expected)
                expect(template.content.firstElementChild?.localName).toEqual('b')
                expect(template.childNodes).toHaveLength(0)
            })
            expect(sanitize).toHaveBeenCalledTimes(1)
        })

        it.each(['mtext', 'mi', 'mo', 'mn', 'ms'])(
            'preserves sanitized HTML and MathML children in %s targets',
            (tag) => {
                document.body.innerHTML =
                    `<math><${tag} id="set-user-properties">Original</${tag}>` +
                    `<${tag} id="set-user-properties">Original</${tag}></math>`
                setRemoteTransform(
                    '<mglyph alt="Glyph"></mglyph><b onclick="alert(1)">Sale</b>' +
                        '<a href="javascript:alert(1)">Buy</a><script>alert(1)</script>'
                )
                const sanitize = vi.spyOn(sanitizerMock.instance!, 'sanitize')

                simulateFeatureFlags({ 'signup-button-test': 'test' })

                document.querySelectorAll('#set-user-properties').forEach((element) => {
                    expect(element.innerHTML).toEqual('<mglyph alt="Glyph"></mglyph><b>Sale</b><a>Buy</a>')
                    expect(element.querySelector('mglyph')?.namespaceURI).toEqual('http://www.w3.org/1998/Math/MathML')
                    expect(element.querySelector('b')?.namespaceURI).toEqual('http://www.w3.org/1999/xhtml')
                })
                expect(sanitize).toHaveBeenCalledTimes(1)
            }
        )

        it.each(['text/html', 'application/xhtml+xml', 'TEXT/HTML', 'APPLICATION/XHTML+XML'])(
            'preserves sanitized HTML in annotation-xml targets with encoding=%s',
            (encoding) => {
                document.body.innerHTML = `<math><annotation-xml id="set-user-properties" encoding="${encoding}">Original</annotation-xml></math>`
                const element = document.querySelector('annotation-xml')!
                setRemoteTransform(
                    '<b onclick="alert(1)">Sale</b><a href="javascript:alert(1)">Buy</a>' +
                        '<script>alert(1)</script><iframe srcdoc="unsafe"></iframe>'
                )

                simulateFeatureFlags({ 'signup-button-test': 'test' })

                expect(element.innerHTML).toEqual('<b>Sale</b><a>Buy</a>')
                expect(element.firstElementChild?.namespaceURI).toEqual('http://www.w3.org/1999/xhtml')
                expect(element.getAttribute('encoding')).toEqual(encoding)
            }
        )

        it.each(['application/xml', ' text/html ', 'text/html;charset=utf-8'])(
            'keeps annotation-xml targets in MathML for encoding=%s',
            (encoding) => {
                document.body.innerHTML = `<math><annotation-xml id="set-user-properties" encoding="${encoding}"></annotation-xml></math>`
                setRemoteTransform('<mi onclick="alert(1)">x</mi>')

                simulateFeatureFlags({ 'signup-button-test': 'test' })

                const element = document.querySelector('annotation-xml')!
                expect(element.innerHTML).toEqual('<mi>x</mi>')
                expect(element.firstElementChild?.namespaceURI).toEqual('http://www.w3.org/1998/Math/MathML')
            }
        )

        it('does not allow annotation-xml elements inside replacement HTML', () => {
            const element = createTestDocument()
            setRemoteTransform(
                '<math><annotation-xml encoding="text/html"><b onclick="alert(1)">Sale</b></annotation-xml></math>'
            )

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            expect(element.innerHTML).toEqual('<math></math>')
        })

        it.each([false, true])('separates cached annotation-xml encodings with reversed order=%s', (reversed) => {
            const encodings = ['text/html', 'application/xml', 'text/html', 'application/xml']
            if (reversed) {
                encodings.reverse()
            }
            document.body.innerHTML =
                '<math>' +
                encodings
                    .map(
                        (encoding) =>
                            `<annotation-xml id="set-user-properties" encoding="${encoding}"></annotation-xml>`
                    )
                    .join('') +
                '</math>'
            setRemoteTransform('<b>Sale</b><mi>x</mi>')
            const sanitize = vi.spyOn(sanitizerMock.instance!, 'sanitize')

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            document.querySelectorAll('annotation-xml').forEach((element) => {
                const isHtml = element.getAttribute('encoding') === 'text/html'
                expect(element.innerHTML).toEqual(isHtml ? '<b>Sale</b>' : '<mi>x</mi>')
                expect(element.firstElementChild?.namespaceURI).toEqual(
                    isHtml ? 'http://www.w3.org/1999/xhtml' : 'http://www.w3.org/1998/Math/MathML'
                )
            })
            expect(sanitize).toHaveBeenCalledTimes(2)
        })

        it('keeps HTML and SVG sanitization results separate for a mixed selector', () => {
            document.body.innerHTML = '<div id="set-user-properties"></div><svg id="set-user-properties"></svg>'
            setRemoteTransform('<circle r="5"></circle>')

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            expect(document.querySelector('div')!.innerHTML).toEqual('')
            expect(document.querySelector('svg')!.innerHTML).toEqual('<circle r="5"></circle>')
            expect(document.querySelector('circle')!.namespaceURI).toEqual('http://www.w3.org/2000/svg')
        })

        it('keeps different HTML parsing contexts separate for a mixed selector', () => {
            document.body.innerHTML =
                '<div id="set-user-properties"></div><table><tbody id="set-user-properties"></tbody></table>'
            setRemoteTransform('<tr><td>Sale</td></tr>')

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            expect(document.querySelector('div')!.innerHTML).toEqual('Sale')
            expect(document.querySelector('tbody')!.innerHTML).toEqual('<tr><td>Sale</td></tr>')
        })

        it.each(['http://www.w3.org/1999/xhtml', 'http://www.w3.org/2000/svg'])(
            'does not transform existing script elements in namespace %s',
            (namespace) => {
                const script = document.createElementNS(namespace, 'script')
                script.id = 'set-user-properties'
                document.body.appendChild(script)
                setRemoteTransform('window.__experimentScriptExecuted = true', 'color:red')

                simulateFeatureFlags({ 'signup-button-test': 'test' })

                expect(posthog._send_request).toHaveBeenCalled()
                expect(script.innerHTML).toEqual('')
                expect(script.hasAttribute('style')).toBe(false)
            }
        )

        it.each([
            ['_blank', '', 'noopener'],
            ['_BLANK', 'noreferrer nofollow', 'noreferrer nofollow noopener'],
            ['_blank', 'opener NOOPENER sponsored', 'sponsored noopener'],
        ])('preserves new-tab links with target=%s and rel=%s', (target, rel, expectedRel) => {
            const element = createTestDocument()
            setRemoteTransform(`<a href="https://example.com/signup" target="${target}" rel="${rel}">Join</a>`)

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            const link = element.querySelector('a')!
            expect(link.getAttribute('href')).toEqual('https://example.com/signup')
            expect(link.getAttribute('target')).toEqual(target)
            expect(link.getAttribute('rel')).toEqual(expectedRel)
        })

        it('preserves new-tab links inside templates and MathML text targets without allowing active URLs', () => {
            document.body.innerHTML =
                '<template id="set-user-properties"></template><math><mtext id="set-user-properties"></mtext></math>'
            setRemoteTransform('<a href="java&#x09;script:alert(1)" target="_blank" rel="opener">Join</a>')

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            const templateLink = document.querySelector('template')!.content.querySelector('a')!
            const mathLink = document.querySelector('mtext a')!
            for (const link of [templateLink, mathLink]) {
                expect(link.hasAttribute('href')).toBe(false)
                expect(link.getAttribute('target')).toEqual('_blank')
                expect(link.getAttribute('rel')).toEqual('noopener')
            }
        })

        it.each(['_top', 'named-window', '_parent'])('does not widen link targets to %s', (target) => {
            const element = createTestDocument()
            setRemoteTransform(`<a href="https://example.com" target="${target}">Join</a>`)

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            expect(element.querySelector('a')!.hasAttribute('target')).toBe(false)
        })

        it.each(['button', 'input', 'select', 'textarea', 'fieldset', 'output'])(
            'preserves external form association for %s controls',
            (tag) => {
                const form = document.createElement('form')
                form.id = 'checkout'
                document.body.appendChild(form)
                const element = createTestDocument()
                setRemoteTransform(`<${tag} id="experiment-control" form="checkout"></${tag}>`)

                simulateFeatureFlags({ 'signup-button-test': 'test' })

                const control = element.querySelector(tag)!
                expect(control.getAttribute('form')).toEqual('checkout')
                expect(form.elements.namedItem('experiment-control')).toBe(control)
            }
        )

        it('preserves external form IDs containing a colon as literal IDs', () => {
            const form = document.createElement('form')
            form.id = 'checkout:cart'
            document.body.appendChild(form)
            const element = createTestDocument()
            setRemoteTransform('<button id="experiment-control" form="checkout:cart">Buy</button>')

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            expect(form.elements.namedItem('experiment-control')).toBe(element.querySelector('button'))
        })

        it('does not allow new target attributes on SVG links or buttons', () => {
            const element = createTestDocument()
            setRemoteTransform(
                '<svg><a href="https://example.com" target="_blank"><text>Link</text></a></svg>' +
                    '<button target="_blank">Buy</button>'
            )

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            expect(element.querySelector('svg a')).not.toBeNull()
            expect(element.querySelector('button')).not.toBeNull()
            expect(element.querySelectorAll('[target]')).toHaveLength(0)
        })

        it('preserves form association without enabling handlers, form overrides or DOM clobbering', () => {
            const form = document.createElement('form')
            form.id = 'checkout'
            document.body.appendChild(form)
            const element = createTestDocument()
            setRemoteTransform(
                '<button id="experiment-control" form="checkout" formaction="javascript:alert(1)" ' +
                    'formtarget="_blank" onclick="alert(1)">Buy</button>' +
                    '<input form="checkout" name="submit"><div form="checkout">Other</div>'
            )

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            const button = element.querySelector('button')!
            expect(form.elements.namedItem('experiment-control')).toBe(button)
            for (const attribute of ['onclick', 'formaction', 'formtarget'])
                expect(button.hasAttribute(attribute)).toBe(false)
            expect(element.querySelector('input')!.hasAttribute('name')).toBe(false)
            expect(element.querySelector('div')!.hasAttribute('form')).toBe(false)
            expect(typeof form.submit).toEqual('function')
        })

        it.each([
            ['SVG use', '<svg><use href="#icon"></use></svg>', '<svg></svg>'],
            ['custom elements', '<experiment-button>Buy</experiment-button>', 'Buy'],
            [
                'framework attributes',
                '<button hx-get="/buy" hx-target="#cart" x-show="open">Buy</button>',
                '<button>Buy</button>',
            ],
            ['stylesheet links', '<link rel="stylesheet" href="/theme.css"><b>Sale</b>', '<b>Sale</b>'],
        ])('continues to remove %s pending a separate compatibility policy', (_name, html, expected) => {
            const element = createTestDocument()
            setRemoteTransform(html)

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            expect(element.innerHTML).toEqual(expected)
        })

        it('preserves safe markup, attributes, links and CSS transformations', () => {
            const html =
                '<h2 class="offer" style="color: blue">Hello <strong>world</strong></h2>' +
                '<a href="https://example.com/signup" title="Sign up">Join</a>' +
                '<img src="/offer.png" alt="Offer"><span data-offer="summer" aria-label="Details">Details</span>'
            setRemoteTransform(html, 'font-size:40px;color:red')
            const element = createTestDocument()

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            expect(element.innerHTML).toEqual(html)
            expect(element.getAttribute('style')).toEqual('font-size:40px;color:red')
        })
    })

    describe('with feature flags', () => {
        it('experiments are disabled by default', () => {
            experimentsResponse = {
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }
            posthog.config = defaultConfig()
            const elParent = createTestDocument()

            simulateFeatureFlags({ 'signup-button-test': 'variant-sign-up' })

            expect(elParent.innerHTML).toEqual('original')
            expect(posthog._send_request).not.toHaveBeenCalled()

            posthog.config.disable_web_experiments = false
            simulateFeatureFlags({ 'signup-button-test': 'variant-sign-up' })
            expect(elParent.innerHTML).toEqual('Sign me up')
        })

        it('makes no modifications if control variant', () => {
            experimentsResponse = {
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }
            // control => do nothing
            assertElementChanged('control', 'innerHTML', 'original')
            expect(posthog.capture).not.toHaveBeenCalled()
        })

        it('can render previews based on URL params', () => {
            experimentsResponse = {
                experiments: [buttonWebExperimentWithUrlConditions],
            }

            const webExperiment = new WebExperiments(posthog)
            const elParent = createTestDocument()
            vi.spyOn(WebExperiments, 'getWindowLocation').mockReturnValue(
                new URL(
                    'https://example.com/landing-page?__experiment_id=3&__experiment_variant=variant-sign-up'
                ) as unknown as Location
            )

            // This forces a preview of 'variant-sign-up', ignoring real flags.
            webExperiment.previewWebExperiment()

            expect(elParent.innerHTML).toEqual('Sign me up')
            expect(posthog.capture).not.toHaveBeenCalled()
        })

        it('can set text of a <span> element', async () => {
            experimentsResponse = {
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }
            // 'variant-sign-up' => "Sign me up"
            assertElementChanged('variant-sign-up', 'innerHTML', 'Sign me up')
            expect(posthog.capture).not.toHaveBeenCalled()
        })

        it('can set child element of a <span> element', async () => {
            experimentsResponse = {
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }
            // variantInnerHtmlTransform => <h1>hello world</h1>
            assertElementChanged('variant-inner-html-transform', 'innerHTML', '<h1>hello world</h1>')
        })

        it('can set css of a <span> element', async () => {
            experimentsResponse = {
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }
            // variantCssTransform => sets 'font-size:40px'
            assertElementChanged('variant-css-transform', 'css', 'font-size:40px')
        })
    })

    function makePostHog(ph: Partial<PostHog>): PostHog {
        return createMockPostHog({
            get_distinct_id() {
                return 'distinctid'
            },
            ...ph,
        })
    }
})
