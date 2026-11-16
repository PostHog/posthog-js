import { BrowserSurveys, getSurveyRenderContext } from '../browser-surveys'
import { BrowserClientAdapter } from '../extensions/browser-client'
import { createMockPostHog } from './helpers/posthog-instance'
import { PostHogPersistence } from '../posthog-persistence'
import { createMockConfig } from './helpers/posthog-instance'
import { getSurveyReplayUrl } from '@posthog/browser-common/survey-render-context'

it('uses only the setup client on modern cores, including pending initialization', async () => {
    const instance = createMockPostHog({
        config: createMockConfig({ disable_surveys: true }),
        requestRouter: { endpointFor: () => 'https://app.example.com' } as any,
        sessionManager: { checkAndGetSessionAndWindowId: () => ({ sessionId: 'session-id' }) } as any,
        _internalEventEmitter: { on: () => () => {} } as any,
    })
    const surveys = new BrowserSurveys(instance)
    instance.surveys = surveys
    const client = new BrowserClientAdapter(instance)
    let finish!: () => void
    vi.spyOn(client.kv, 'initialize').mockImplementation(
        () =>
            new Promise<void>((resolve) => {
                finish = resolve
            })
    )
    expect(getSurveyRenderContext(instance)).toBeUndefined()
    const setup = surveys.setup(client)
    expect(getSurveyRenderContext(instance)).toBeUndefined()
    finish()
    await setup
    const context = getSurveyRenderContext(instance)!
    expect(context.client).toBe(client)
    expect(context.surveys).toBe(surveys)
    expect(getSurveyReplayUrl(context)).toBe('https://app.example.com/project/test-token/replay/session-id')
    surveys.dispose()
    expect(getSurveyRenderContext(instance)).toBeUndefined()
})

it('borrows released-core capabilities without starting a second lifecycle or subscriptions', () => {
    const config = createMockConfig({ persistence: 'memory' })
    const persistence = new PostHogPersistence(config)
    const flags = { onFeatureFlags: vi.fn(), getFeatureFlag: vi.fn(), setup: vi.fn(), dispose: vi.fn() }
    const instance = createMockPostHog({
        config,
        persistence,
        featureFlags: flags as any,
        surveys: { getSurveys: vi.fn() } as any,
        onSessionId: vi.fn(() => () => {}),
        _addCaptureHook: vi.fn(() => () => {}),
        has_opted_out_capturing: vi.fn(() => false),
    })
    delete (instance as Partial<typeof instance>).is_capturing
    const context = getSurveyRenderContext(instance)!
    expect(getSurveyRenderContext(instance)).toBe(context)
    expect(context.surveys).toBe(instance.surveys)
    expect(context.client!.constructor).toBe(BrowserClientAdapter)
    expect(context.client!.getExtension('featureFlagsCommon')).toBe(flags)
    persistence.register({ '$surveys': [{ id: 'cached' }] })
    expect(context.client!.kv.get('$surveys')).toEqual([{ id: 'cached' }])
    expect(context.client!.canCapture).toBe(true)
    expect(instance.onSessionId).not.toHaveBeenCalled()
    expect(instance._addCaptureHook).not.toHaveBeenCalled()
    expect(flags.onFeatureFlags).not.toHaveBeenCalled()
    expect(flags.setup).not.toHaveBeenCalled()
    expect(flags.dispose).not.toHaveBeenCalled()
    persistence.clear()
})
