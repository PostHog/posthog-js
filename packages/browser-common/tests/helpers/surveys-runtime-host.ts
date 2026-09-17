import { vi } from 'vitest'
import type { SurveysRuntimeHost } from '../../src/surveys-runtime-host'
import { uuidv7 } from '../../src/utils/uuidv7'

export type MockSurveysRuntimeHost = { -readonly [K in keyof SurveysRuntimeHost]: SurveysRuntimeHost[K] }

export const createSurveysRuntimeHost = (overrides: Partial<SurveysRuntimeHost> = {}): MockSurveysRuntimeHost => ({
    canCapture: true,
    prefillFromUrl: false,
    automaticDisplay: true,
    hasLoadedFlags: false,
    featureFlagEvaluation: true,
    overrideLanguage: undefined,
    storedPersonProperties: undefined,
    eventReceiver: undefined,
    getCachedSurveys: vi.fn(),
    storage: localStorage,
    capture: vi.fn(),
    getSurveys: vi.fn(),
    onFlags: vi.fn(() => () => {}),
    getFlag: vi.fn(),
    isFlagEnabled: vi.fn(),
    reloadFlags: vi.fn(),
    getReplayUrl: vi.fn(),
    getTargetingUrl: () => window.location.href,
    prepareStylesheet: undefined,
    createSubmissionId: () => uuidv7(),
    ...overrides,
})
