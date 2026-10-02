import { vi } from 'vitest'
import type { SurveyTriggerHost } from '../../src/survey-event-receiver'
import type { SurveyEventHost } from '../../src/survey-event-host'
import type { KeyValueStore } from '../../src/persistence'
import { TestClient, InMemoryKeyValueStore } from './test-client'
export type SurveyTriggerFixture = SurveyEventHost &
    SurveyTriggerHost & { kv: KeyValueStore; client: TestClient; cancelSurvey(id: string): void }
export const createSurveyTriggerHost = (overrides: Partial<SurveyTriggerFixture> = {}): SurveyTriggerFixture => {
    const kv = overrides.kv ?? new InMemoryKeyValueStore()
    const fixture = {
        kv,
        getProperty: (key: string) => kv.get(key),
        getSessionId: () => 'session-id',
        subscribeCapture: vi.fn(() => () => {}),
        setElementSelectors: vi.fn(),
        getSurveys: vi.fn(),
        cancelSurvey: vi.fn(),
        ...overrides,
    } as SurveyTriggerFixture
    fixture.cancelPendingSurvey = (id) => fixture.cancelSurvey(id)
    fixture.client = new TestClient()
    Object.defineProperties(fixture.client, {
        kv: { value: kv },
        session: {
            get: () => {
                const sessionId = fixture.getSessionId()
                return sessionId ? { sessionId } : undefined
            },
        },
        onSession: {
            value: (listener: (id: string) => void) => ({
                dispose: fixture.subscribeSession?.(listener) ?? (() => {}),
            }),
        },
        onEvent: {
            value: (listener: (event: unknown) => void) => ({
                dispose:
                    fixture.subscribeCapture?.((event, payload) => listener(payload ?? { event, properties: {} })) ??
                    (() => {}),
            }),
        },
        getExtension: { value: () => fixture },
    })
    return fixture
}
