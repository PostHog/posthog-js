import { vi } from 'vitest'
import type { SurveyTriggerHost } from '../../src/survey-event-receiver'
import { InMemoryKeyValueStore } from './test-client'

export const createSurveyTriggerHost = (overrides: Partial<SurveyTriggerHost> = {}): SurveyTriggerHost => {
    const kv = overrides.kv ?? new InMemoryKeyValueStore()
    return {
        kv,
        getProperty: (key) => kv.get(key),
        getSessionId: () => 'session-id',
        subscribeCapture: vi.fn(() => () => {}),
        setElementSelectors: vi.fn(),
        getSurveys: vi.fn(),
        cancelSurvey: vi.fn(),
        ...overrides,
    }
}
