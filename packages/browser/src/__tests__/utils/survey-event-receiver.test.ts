/// <reference lib="dom" />
import { SurveyType, SurveyQuestionType, Survey, SurveyEventName, SurveySchedule } from '../../posthog-surveys-types'
import { SURVEYS_ACTIVATED_TIMESTAMPS } from '../../constants'
import { PostHogPersistence } from '../../posthog-persistence'
import { PostHog } from '../../posthog-core'
import { CaptureResult, PostHogConfig } from '../../types'
import { SurveyEventReceiver } from '../../utils/survey-event-receiver'
import { createMockPostHog, createMockConfig } from '../helpers/posthog-instance'

describe('survey-event-receiver', () => {
    describe('activation lifecycle (reload persistence)', () => {
        let config: PostHogConfig
        let instance: PostHog
        let mockAddCaptureHook: vi.Mock
        // Mutable so tests can simulate a session rollover between reloads.
        let currentSessionId: string
        // Captures the receiver's onSessionId subscription so tests can drive a live rotation.
        let sessionIdListeners: Array<(sessionId: string) => void>
        const rotateSession = (sessionId: string): void => {
            currentSessionId = sessionId
            sessionIdListeners.forEach((listener) => listener(sessionId))
        }

        const makeSurvey = (overrides: Partial<Survey>): Survey =>
            ({
                name: 'lifecycle survey',
                id: 'lifecycle-survey',
                description: 'lifecycle survey description',
                type: SurveyType.Popover,
                questions: [{ type: SurveyQuestionType.Open, question: 'how is it going?' }],
                conditions: {
                    events: { values: [{ name: 'trigger_event' }] },
                },
                ...overrides,
            }) as unknown as Survey

        const surveyEventPayload = (surveyId: string, event: string): CaptureResult =>
            ({
                event,
                properties: { $survey_id: surveyId },
            }) as unknown as CaptureResult

        const setup = (survey: Survey) => {
            config = createMockConfig({
                token: 'testtoken',
                api_host: 'https://app.posthog.com',
                persistence: 'memory',
            })
            instance = createMockPostHog({
                config,
                persistence: new PostHogPersistence(config),
                _addCaptureHook: mockAddCaptureHook,
                getSurveys: vi.fn((callback) => callback([survey])),
                get_session_id: () => currentSessionId,
                onSessionId: (listener: (sessionId: string) => void) => {
                    sessionIdListeners.push(listener)
                    return () => {}
                },
            })
            const receiver = new SurveyEventReceiver(instance)
            receiver.register([survey])
            const hook = mockAddCaptureHook.mock.calls[0][0]
            return { receiver, hook }
        }

        beforeEach(() => {
            mockAddCaptureHook = vi.fn()
            currentSessionId = 'session-1'
            sessionIdListeners = []
        })

        afterEach(() => {
            instance.persistence?.clear()
        })

        it('keeps a non-repeatable survey activated after it is shown (survives reload)', () => {
            const { receiver, hook } = setup(makeSurvey({}))

            hook('trigger_event')
            expect(receiver.getSurveys()).toContain('lifecycle-survey')

            hook(SurveyEventName.SHOWN, surveyEventPayload('lifecycle-survey', SurveyEventName.SHOWN))
            // still activated: a reload re-reads persistence and re-displays it
            expect(receiver.getSurveys()).toContain('lifecycle-survey')
        })

        it.each([
            ['dismissed', SurveyEventName.DISMISSED],
            ['sent', SurveyEventName.SENT],
        ])('removes a non-repeatable survey from activated once it is %s', (_label, interactionEvent) => {
            const { receiver, hook } = setup(makeSurvey({}))

            hook('trigger_event')
            hook(SurveyEventName.SHOWN, surveyEventPayload('lifecycle-survey', SurveyEventName.SHOWN))
            expect(receiver.getSurveys()).toContain('lifecycle-survey')

            hook(interactionEvent, surveyEventPayload('lifecycle-survey', interactionEvent))
            expect(receiver.getSurveys()).not.toContain('lifecycle-survey')
        })

        it.each([
            [
                'repeatedActivation',
                { conditions: { events: { values: [{ name: 'trigger_event' }], repeatedActivation: true } } },
            ],
            ['always schedule', { schedule: SurveySchedule.Always }],
        ])('consumes a repeatable survey (%s) when it is shown', (_label, overrides) => {
            const { receiver, hook } = setup(makeSurvey(overrides as unknown as Partial<Survey>))

            hook('trigger_event')
            hook(SurveyEventName.SHOWN, surveyEventPayload('lifecycle-survey', SurveyEventName.SHOWN))
            expect(receiver.getSurveys()).not.toContain('lifecycle-survey')
        })

        // A fresh receiver reading the same persistence models a page reload: in-memory
        // (armed, not yet shown) activations are gone, persisted (shown) ones remain.
        it('does not let an armed-but-unshown survey survive a reload', () => {
            const { receiver, hook } = setup(makeSurvey({}))

            hook('trigger_event')
            // armed in this session...
            expect(receiver.getSurveys()).toContain('lifecycle-survey')
            // ...but never written to persistence, so a reload does not re-display it
            expect(new SurveyEventReceiver(instance).getSurveys()).not.toContain('lifecycle-survey')
        })

        it('persists a non-repeatable survey only once shown, so it survives a reload', () => {
            const { hook } = setup(makeSurvey({}))

            hook('trigger_event')
            expect(new SurveyEventReceiver(instance).getSurveys()).not.toContain('lifecycle-survey')

            hook(SurveyEventName.SHOWN, surveyEventPayload('lifecycle-survey', SurveyEventName.SHOWN))
            expect(new SurveyEventReceiver(instance).getSurveys()).toContain('lifecycle-survey')

            hook(SurveyEventName.DISMISSED, surveyEventPayload('lifecycle-survey', SurveyEventName.DISMISSED))
            expect(new SurveyEventReceiver(instance).getSurveys()).not.toContain('lifecycle-survey')
        })

        it('does not re-display a shown-but-unanswered survey in a brand-new session', () => {
            const { hook } = setup(makeSurvey({}))

            // Triggered and shown in session-1 (persisted so it survives a reload)...
            hook('trigger_event')
            hook(SurveyEventName.SHOWN, surveyEventPayload('lifecycle-survey', SurveyEventName.SHOWN))
            expect(new SurveyEventReceiver(instance).getSurveys()).toContain('lifecycle-survey')

            // ...but a brand-new session (no fresh trigger event) must not re-display it.
            currentSessionId = 'session-2'
            expect(new SurveyEventReceiver(instance).getSurveys()).not.toContain('lifecycle-survey')
        })

        it('re-arms in a new session only when the trigger fires again', () => {
            const { hook } = setup(makeSurvey({}))

            hook('trigger_event')
            hook(SurveyEventName.SHOWN, surveyEventPayload('lifecycle-survey', SurveyEventName.SHOWN))

            // New session: stale activation is dropped until the trigger fires again.
            currentSessionId = 'session-2'
            const afterRollover = new SurveyEventReceiver(instance)
            afterRollover.register([makeSurvey({})])
            expect(afterRollover.getSurveys()).not.toContain('lifecycle-survey')

            const rearmHook = mockAddCaptureHook.mock.calls.at(-1)?.[0]
            rearmHook('trigger_event')
            expect(afterRollover.getSurveys()).toContain('lifecycle-survey')
        })

        it('drops a shown survey when the session rotates live (idle timeout), without a reload', () => {
            const { receiver, hook } = setup(makeSurvey({}))

            hook('trigger_event')
            hook(SurveyEventName.SHOWN, surveyEventPayload('lifecycle-survey', SurveyEventName.SHOWN))
            expect(receiver.getSurveys()).toContain('lifecycle-survey')

            // The session rotates in-place (e.g. idle timeout) on the same receiver — a case the
            // read-only session read cannot observe, so the onSessionId subscription must handle it.
            rotateSession('session-2')
            expect(receiver.getSurveys()).not.toContain('lifecycle-survey')
            // Cleared from persistence too, so a subsequent reload doesn't resurrect it.
            expect(new SurveyEventReceiver(instance).getSurveys()).not.toContain('lifecycle-survey')
        })

        it('keeps a shown survey when the session id fires but is unchanged (e.g. window-id-only change)', () => {
            const { receiver, hook } = setup(makeSurvey({}))

            hook('trigger_event')
            hook(SurveyEventName.SHOWN, surveyEventPayload('lifecycle-survey', SurveyEventName.SHOWN))

            // onSessionId can fire without the session id actually changing; that must not clear it.
            sessionIdListeners.forEach((listener) => listener('session-1'))
            expect(receiver.getSurveys()).toContain('lifecycle-survey')
        })

        it.each([
            [
                'repeatedActivation',
                { conditions: { events: { values: [{ name: 'trigger_event' }], repeatedActivation: true } } },
            ],
            ['always schedule', { schedule: SurveySchedule.Always }],
        ])('never persists a repeatable survey (%s), so it cannot survive a reload', (_label, overrides) => {
            const { hook } = setup(makeSurvey(overrides as unknown as Partial<Survey>))

            hook('trigger_event')
            hook(SurveyEventName.SHOWN, surveyEventPayload('lifecycle-survey', SurveyEventName.SHOWN))
            expect(new SurveyEventReceiver(instance).getSurveys()).not.toContain('lifecycle-survey')
        })

        it('consumes on shown when the survey cannot be resolved (does not promote to persistence)', () => {
            const { receiver, hook } = setup(makeSurvey({}))

            hook('trigger_event')
            expect(receiver.getSurveys()).toContain('lifecycle-survey')

            // The survey is no longer resolvable (e.g. surveys unloaded): shown should consume it,
            // not promote an unknown survey into persistence where it would re-display on reload.
            ;(instance.getSurveys as vi.Mock).mockImplementation((cb) => cb([]))
            hook(SurveyEventName.SHOWN, surveyEventPayload('lifecycle-survey', SurveyEventName.SHOWN))

            expect(receiver.getSurveys()).not.toContain('lifecycle-survey')
            expect(new SurveyEventReceiver(instance).getSurveys()).not.toContain('lifecycle-survey')
        })

        it('getSurveys() returns the union of armed (memory) and shown (persisted) surveys', () => {
            const armed = makeSurvey({
                id: 'armed-survey',
                conditions: { events: { values: [{ name: 'arm_event' }] } },
            })
            const shown = makeSurvey({
                id: 'shown-survey',
                conditions: { events: { values: [{ name: 'show_event' }] } },
            })
            config = createMockConfig({
                token: 'testtoken',
                api_host: 'https://app.posthog.com',
                persistence: 'memory',
            })
            instance = createMockPostHog({
                config,
                persistence: new PostHogPersistence(config),
                _addCaptureHook: mockAddCaptureHook,
                getSurveys: vi.fn((callback) => callback([armed, shown])),
                get_session_id: () => currentSessionId,
            })
            const receiver = new SurveyEventReceiver(instance)
            receiver.register([armed, shown])
            const hook = mockAddCaptureHook.mock.calls[0][0]

            hook('arm_event') // armed in memory only
            hook('show_event')
            hook(SurveyEventName.SHOWN, surveyEventPayload('shown-survey', SurveyEventName.SHOWN)) // promoted to persistence

            // Both are active in-session (the union of memory + persistence)...
            expect(receiver.getSurveys()).toEqual(expect.arrayContaining(['armed-survey', 'shown-survey']))
            // ...but only the shown one survives a reload.
            const afterReload = new SurveyEventReceiver(instance)
            expect(afterReload.getSurveys()).toContain('shown-survey')
            expect(afterReload.getSurveys()).not.toContain('armed-survey')
        })

        it('reset() clears an armed-but-unshown activation (e.g. on logout without a reload)', () => {
            const { receiver, hook } = setup(makeSurvey({}))

            hook('trigger_event')
            expect(receiver.getSurveys()).toContain('lifecycle-survey')

            receiver.reset()
            expect(receiver.getSurveys()).not.toContain('lifecycle-survey')
        })

        it('reset() clears a shown (persisted) activation too', () => {
            const { receiver, hook } = setup(makeSurvey({}))

            hook('trigger_event')
            hook(SurveyEventName.SHOWN, surveyEventPayload('lifecycle-survey', SurveyEventName.SHOWN))
            expect(receiver.getSurveys()).toContain('lifecycle-survey')

            receiver.reset()
            expect(receiver.getSurveys()).not.toContain('lifecycle-survey')
            expect(new SurveyEventReceiver(instance).getSurveys()).not.toContain('lifecycle-survey')
        })
    })

    describe('delayed survey activation (survives navigation)', () => {
        let config: PostHogConfig
        let instance: PostHog
        let mockAddCaptureHook: vi.Mock
        let currentSessionId: string
        let sessionIdListeners: Array<(sessionId: string) => void>
        let nowSpy: vi.SpyInstance

        const rotateSession = (sessionId: string): void => {
            currentSessionId = sessionId
            sessionIdListeners.forEach((listener) => listener(sessionId))
        }

        const makeDelayedSurvey = (overrides: Partial<Survey> = {}): Survey =>
            ({
                name: 'delayed survey',
                id: 'delayed-survey',
                description: 'delayed survey description',
                type: SurveyType.Popover,
                questions: [{ type: SurveyQuestionType.Open, question: 'how is it going?' }],
                appearance: { surveyPopupDelaySeconds: 60 },
                conditions: { events: { values: [{ name: 'trigger_event' }] } },
                ...overrides,
            }) as unknown as Survey

        const surveyEventPayload = (surveyId: string, event: string): CaptureResult =>
            ({ event, properties: { $survey_id: surveyId } }) as unknown as CaptureResult

        const setup = (survey: Survey, hasSession = true) => {
            config = createMockConfig({
                token: 'testtoken',
                api_host: 'https://app.posthog.com',
                persistence: 'memory',
            })
            instance = createMockPostHog({
                config,
                persistence: new PostHogPersistence(config),
                _addCaptureHook: mockAddCaptureHook,
                getSurveys: vi.fn((callback) => callback([survey])),
                get_session_id: () => (hasSession ? currentSessionId : undefined),
                cancelPendingSurvey: vi.fn(),
                onSessionId: (listener: (sessionId: string) => void) => {
                    sessionIdListeners.push(listener)
                    return () => {}
                },
            })
            const receiver = new SurveyEventReceiver(instance)
            receiver.register([survey])
            const hook = mockAddCaptureHook.mock.calls.at(-1)?.[0]
            return { receiver, hook }
        }

        beforeEach(() => {
            mockAddCaptureHook = vi.fn()
            currentSessionId = 'session-1'
            sessionIdListeners = []
            nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
        })

        afterEach(() => {
            nowSpy.mockRestore()
            instance.persistence?.clear()
        })

        it('persists an armed delayed survey and records the activation time, so it survives a reload', () => {
            const { receiver, hook } = setup(makeDelayedSurvey())

            hook('trigger_event')
            expect(receiver.getSurveys()).toContain('delayed-survey')
            expect(receiver.getActivationTimestamp('delayed-survey')).toBe(1_000_000)

            // A fresh receiver reading the same persistence models the next page load.
            const afterNav = new SurveyEventReceiver(instance)
            expect(afterNav.getSurveys()).toContain('delayed-survey')
            expect(afterNav.getActivationTimestamp('delayed-survey')).toBe(1_000_000)
        })

        it('keeps the first activation time when the trigger fires again before the survey is shown', () => {
            const { receiver, hook } = setup(makeDelayedSurvey())

            hook('trigger_event')
            nowSpy.mockReturnValue(1_050_000)
            hook('trigger_event')

            expect(receiver.getActivationTimestamp('delayed-survey')).toBe(1_000_000)
        })

        it('replaces a stale activation timestamp when starting a new activation', () => {
            const { receiver, hook } = setup(makeDelayedSurvey())
            instance.persistence?.register({
                [SURVEYS_ACTIVATED_TIMESTAMPS]: { 'delayed-survey': 900_000 },
            })

            hook('trigger_event')

            expect(receiver.getActivationTimestamp('delayed-survey')).toBe(1_000_000)
        })

        it('does not persist an armed survey without a delay (keeps the exit-intent scoping)', () => {
            const { receiver, hook } = setup(makeDelayedSurvey({ appearance: {} }))

            hook('trigger_event')
            expect(receiver.getSurveys()).toContain('delayed-survey')
            // In-memory only: no timestamp and it does not survive a reload.
            expect(receiver.getActivationTimestamp('delayed-survey')).toBeUndefined()
            expect(new SurveyEventReceiver(instance).getSurveys()).not.toContain('delayed-survey')
        })

        it('drops the delayed activation and pending timer when the session rotates', () => {
            const { receiver, hook } = setup(makeDelayedSurvey())

            hook('trigger_event')
            expect(receiver.getSurveys()).toContain('delayed-survey')

            rotateSession('session-2')
            expect(receiver.getSurveys()).not.toContain('delayed-survey')
            expect(receiver.getActivationTimestamp('delayed-survey')).toBeUndefined()
            expect(new SurveyEventReceiver(instance).getActivationTimestamp('delayed-survey')).toBeUndefined()
            expect(instance.cancelPendingSurvey).toHaveBeenCalledWith('delayed-survey')
        })

        it.each([
            ['dismissed', SurveyEventName.DISMISSED],
            ['sent', SurveyEventName.SENT],
        ])('removes the activation once the survey is %s', (_label, interactionEvent) => {
            const { receiver, hook } = setup(makeDelayedSurvey())

            hook('trigger_event')
            hook(SurveyEventName.SHOWN, surveyEventPayload('delayed-survey', SurveyEventName.SHOWN))

            hook(interactionEvent, surveyEventPayload('delayed-survey', interactionEvent))
            expect(receiver.getSurveys()).not.toContain('delayed-survey')
        })

        // A cancel event deactivates a survey that was never shown, so it is the one path that
        // still has a timestamp to clean up. Asserted on persistence directly because
        // getActivationTimestamp reads through the activation set and would hide a leaked entry.
        it('forgets the stored activation time when a cancel event fires before the survey is shown', () => {
            const { receiver, hook } = setup(
                makeDelayedSurvey({
                    conditions: {
                        events: { values: [{ name: 'trigger_event' }] },
                        cancelEvents: { values: [{ name: 'cancel_event' }] },
                    },
                } as Partial<Survey>)
            )

            hook('trigger_event')
            expect(receiver.getActivationTimestamp('delayed-survey')).toBe(1_000_000)

            hook('cancel_event')
            expect(receiver.getSurveys()).not.toContain('delayed-survey')
            expect(instance.persistence?.props[SURVEYS_ACTIVATED_TIMESTAMPS]).toBeUndefined()
        })

        it('drops the activation time once the survey is shown, so a later page waits the full delay', () => {
            const { receiver, hook } = setup(makeDelayedSurvey())

            hook('trigger_event')
            hook(SurveyEventName.SHOWN, surveyEventPayload('delayed-survey', SurveyEventName.SHOWN))

            // Still activated, so a reload re-displays it until the user dismisses or answers it...
            expect(receiver.getSurveys()).toContain('delayed-survey')
            // ...but with no activation time the next page counts the whole delay down again
            // instead of re-rendering the survey instantly.
            expect(receiver.getActivationTimestamp('delayed-survey')).toBeUndefined()
            expect(new SurveyEventReceiver(instance).getActivationTimestamp('delayed-survey')).toBeUndefined()
        })

        it('does not record a new activation time when the trigger fires again after the survey is shown', () => {
            const { receiver, hook } = setup(makeDelayedSurvey())

            hook('trigger_event')
            hook(SurveyEventName.SHOWN, surveyEventPayload('delayed-survey', SurveyEventName.SHOWN))
            nowSpy.mockReturnValue(1_030_000)
            hook('trigger_event')

            expect(receiver.getActivationTimestamp('delayed-survey')).toBeUndefined()
        })

        it('falls back to in-memory arming for a delayed survey when no session id is resolvable', () => {
            const { receiver, hook } = setup(makeDelayedSurvey(), false)

            hook('trigger_event')
            // Still armed in-session so the current page works...
            expect(receiver.getSurveys()).toContain('delayed-survey')
            // ...but with no session to scope it, it is not persisted across a reload.
            expect(receiver.getActivationTimestamp('delayed-survey')).toBeUndefined()
            expect(new SurveyEventReceiver(instance).getSurveys()).not.toContain('delayed-survey')
        })
    })
})
