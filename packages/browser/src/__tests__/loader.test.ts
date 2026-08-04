/*
 * Test that basic SDK usage (init, capture, etc) does not
 * blow up in non-browser (node.js) envs. These are not
 * tests of server-side capturing functionality (which is
 * currently not supported in the browser lib).
 */

import { init_from_snippet, PostHog } from '../posthog-core'
import { defaultPostHog } from './helpers/posthog-instance'

import sinon from 'sinon'
import { window } from '@posthog/browser-common/utils/globals'
import { assignableWindow } from '../utils/globals'

describe(`Module-based loader in Node env`, () => {
    const posthog = defaultPostHog()

    beforeEach(() => {
        // NOTE: Temporary change whilst testing remote config
        assignableWindow._POSTHOG_REMOTE_CONFIG = {
            'test-token': {
                config: {},
                siteApps: [],
            },
        } as any
        // assignableWindow.__PosthogExtensions__ = {}

        jest.useFakeTimers()
        jest.spyOn(posthog, '_send_request').mockReturnValue()
        jest.spyOn(window!.console, 'log').mockImplementation()
    })

    it('should load and capture the pageview event', () => {
        const sandbox = sinon.createSandbox()
        let loaded = false
        const _originalCapture = posthog.capture
        posthog.capture = sandbox.spy()
        posthog.init(`test-token`, {
            disable_surveys: true,
            disable_conversations: true,
            debug: true,
            persistence: `localStorage`,
            api_host: `https://test.com`,
            loaded: function () {
                loaded = true
            },
        })

        jest.runOnlyPendingTimers()

        sinon.assert.calledOnce(posthog.capture as sinon.SinonSpy<any>)
        const captureArgs = (posthog.capture as sinon.SinonSpy<any>).args[0]
        const event = captureArgs[0]
        expect(event).toBe('$pageview')
        expect(loaded).toBe(true)

        posthog.capture = _originalCapture
    })

    it(`supports identify()`, () => {
        expect(() => posthog.identify(`Pat`)).not.toThrow()
    })

    it(`supports capture()`, () => {
        expect(() => posthog.capture(`Pat`)).not.toThrow()
    })

    it(`always returns posthog from init`, () => {
        console.error = jest.fn()
        console.warn = jest.fn()

        expect(posthog.init(`my-test`, { disable_surveys: true, disable_conversations: true }, 'sdk-1')).toBeInstanceOf(
            PostHog
        )
        expect(posthog.init(``, { disable_surveys: true, disable_conversations: true }, 'sdk-2')).toBeInstanceOf(
            PostHog
        )
        const nullTokenInstance = posthog.init(
            null as any,
            { disable_surveys: true, disable_conversations: true },
            'sdk-null'
        )
        expect(nullTokenInstance).toBeInstanceOf(PostHog)
        expect((nullTokenInstance as any).__loaded).toBe(false)

        expect(console.error).toHaveBeenCalledWith(
            '[PostHog.js]',
            'PostHog was initialized without a token. This likely indicates a misconfiguration. Please check the first argument passed to posthog.init()'
        )

        expect(
            posthog.init(`  trim-me\n`, { disable_surveys: true, disable_conversations: true }, 'sdk-trim').config.token
        ).toBe('trim-me')

        // Already loaded logged even when not debug
        expect(posthog.init(`my-test`, { disable_surveys: true, disable_conversations: true }, 'sdk-1')).toBeInstanceOf(
            PostHog
        )
        expect(console.warn).toHaveBeenCalledWith(
            '[PostHog.js]',
            'You have already initialized PostHog! Re-initializing is a no-op'
        )
    })

    it(`names the token mismatch when re-initializing with a different token`, () => {
        console.warn = jest.fn()

        const instance = new PostHog()
        instance.init(`phc_first`, { disable_surveys: true, disable_conversations: true })
        expect(instance.config.token).toBe('phc_first')

        const second = instance.init(`phc_second`, { disable_surveys: true, disable_conversations: true })
        expect(second).toBe(instance)
        expect(second.config.token).toBe('phc_first')

        expect(console.warn).toHaveBeenCalledWith(
            '[PostHog.js]',
            "You have already initialized PostHog with a different project token! Re-initializing is a no-op, so events will keep going to the project this instance was initialized with. To capture into a second project, load PostHog once, then initialize a named instance after the SDK has loaded, e.g. posthog.init('phc_second', { ... }, 'project2')"
        )
    })
})

describe('Snippet loader', () => {
    const snippetConfig = () => ({
        advanced_disable_feature_flags: true,
        autocapture: false,
        capture_pageview: false,
        disable_conversations: true,
        disable_session_recording: true,
        disable_surveys: true,
    })

    afterEach(() => {
        assignableWindow.posthog = undefined as any
        jest.restoreAllMocks()
    })

    it('preserves the loaded instance and replays a shared queue once when array.js executes twice', () => {
        jest.spyOn(PostHog.prototype, '_send_request').mockReturnValue()
        jest.spyOn(console, 'warn').mockImplementation()

        const queuedCall = jest.fn()
        const snippetPostHog = [queuedCall] as any
        snippetPostHog.__SV = 1
        snippetPostHog.people = []
        snippetPostHog._i = [
            ['phc_first', snippetConfig(), 'posthog'],
            ['phc_second', snippetConfig(), 'posthog'],
        ]
        assignableWindow.posthog = snippetPostHog

        init_from_snippet()

        const loadedPostHog = assignableWindow.posthog
        expect(loadedPostHog.__loaded).toBe(true)
        expect(loadedPostHog.config.token).toBe('phc_first')
        expect(queuedCall).toHaveBeenCalledTimes(1)

        init_from_snippet()

        expect(assignableWindow.posthog).toBe(loadedPostHog)
        expect(assignableWindow.posthog.__loaded).toBe(true)
        expect(assignableWindow.posthog.config.token).toBe('phc_first')
        expect(queuedCall).toHaveBeenCalledTimes(1)
    })

    it('preserves primary and named instances when array.js executes twice', () => {
        jest.spyOn(PostHog.prototype, '_send_request').mockReturnValue()

        const primaryQueuedCall = jest.fn()
        const namedQueuedCall = jest.fn()
        const snippetPostHog = [primaryQueuedCall] as any
        snippetPostHog.__SV = 1
        snippetPostHog.people = []
        snippetPostHog.project2 = [namedQueuedCall]
        snippetPostHog.project2.people = []
        snippetPostHog._i = [
            ['phc_first', snippetConfig(), 'posthog'],
            ['phc_second', snippetConfig(), 'project2'],
        ]
        assignableWindow.posthog = snippetPostHog

        init_from_snippet()

        const loadedPostHog = assignableWindow.posthog
        const project2 = loadedPostHog.project2
        expect(loadedPostHog.__SV).toBe(1)
        expect(loadedPostHog.config.token).toBe('phc_first')
        expect(project2.config.token).toBe('phc_second')
        expect(primaryQueuedCall).toHaveBeenCalledTimes(1)
        expect(namedQueuedCall).toHaveBeenCalledTimes(1)

        init_from_snippet()

        expect(assignableWindow.posthog).toBe(loadedPostHog)
        expect(assignableWindow.posthog.project2).toBe(project2)
        expect(primaryQueuedCall).toHaveBeenCalledTimes(1)
        expect(namedQueuedCall).toHaveBeenCalledTimes(1)
    })

    it('preserves named instances when the primary instance is not initialized', () => {
        jest.spyOn(PostHog.prototype, '_send_request').mockReturnValue()

        const snippetPostHog = [] as any
        snippetPostHog.__SV = 1
        snippetPostHog.people = []
        snippetPostHog.namedOnly1 = []
        snippetPostHog.namedOnly1.people = []
        snippetPostHog.namedOnly2 = []
        snippetPostHog.namedOnly2.people = []
        snippetPostHog._i = [
            ['phc_first', snippetConfig(), 'namedOnly1'],
            ['phc_second', snippetConfig(), 'namedOnly2'],
        ]
        assignableWindow.posthog = snippetPostHog

        init_from_snippet()

        const loadedPostHog = assignableWindow.posthog
        const namedOnly1 = loadedPostHog.namedOnly1
        const namedOnly2 = loadedPostHog.namedOnly2
        expect(loadedPostHog.__loaded).toBe(false)
        expect(namedOnly1.config.token).toBe('phc_first')
        expect(namedOnly2.config.token).toBe('phc_second')

        init_from_snippet()

        expect(assignableWindow.posthog).toBe(loadedPostHog)
        expect(assignableWindow.posthog.namedOnly1).toBe(namedOnly1)
        expect(assignableWindow.posthog.namedOnly2).toBe(namedOnly2)
    })
})
