import { vi } from 'vitest'
import type { SurveyRenderContext } from '../../src/survey-render-context'
import type { Properties, FeatureFlagOptions, IsFeatureEnabledOptions } from '@posthog/types'
import type { Survey, SurveyCallback } from '../../src/types/surveys'
import type { SurveysEventReceiver } from '../../src/surveys-config'
import { TestClient } from './test-client'

interface SurveyFixtureOptions {
    readonly canCapture: boolean
    readonly prefillFromUrl: boolean
    readonly automaticDisplay: boolean
    readonly hasLoadedFlags: boolean
    readonly featureFlagEvaluation: boolean
    readonly overrideLanguage: string | null | undefined
    readonly storedPersonProperties: Properties | undefined
    readonly eventReceiver: SurveysEventReceiver | null | undefined
    getCachedSurveys(): Survey[] | undefined
    capture(event: string, properties?: Properties, options?: { delivery?: 'unload' }): void
    getSurveys(callback: SurveyCallback, forceReload?: boolean): void
    onFlags(callback: () => void): () => void
    getFlag(key: string, options?: FeatureFlagOptions): string | boolean | undefined
    isFlagEnabled(key: string, options?: IsFeatureEnabledOptions): boolean | undefined
    reloadFlags(): void
    getTargetingUrl(): string | undefined
    prepareStylesheet: ((stylesheet: HTMLStyleElement) => HTMLStyleElement | null) | undefined
}

export type MockSurveyRenderContext = SurveyRenderContext & {
    -readonly [K in keyof SurveyFixtureOptions]: SurveyFixtureOptions[K]
}

export const createSurveyRenderContext = (overrides: Partial<SurveyFixtureOptions> = {}): MockSurveyRenderContext => {
    const fixture = {
        canCapture: true,
        prefillFromUrl: false,
        automaticDisplay: true,
        hasLoadedFlags: false,
        featureFlagEvaluation: true,
        overrideLanguage: undefined,
        storedPersonProperties: undefined,
        eventReceiver: undefined,
        getCachedSurveys: vi.fn(),
        capture: vi.fn(),
        getSurveys: vi.fn(),
        onFlags: vi.fn(() => () => {}),
        getFlag: vi.fn(),
        isFlagEnabled: vi.fn(),
        reloadFlags: vi.fn(),
        getTargetingUrl: () => window.location.href,
        prepareStylesheet: undefined,
        ...overrides,
    } as MockSurveyRenderContext
    const client = new TestClient()
    Object.defineProperty(client, 'canCapture', { get: () => fixture.canCapture })
    client.capture = (event, properties, options) =>
        options
            ? fixture.capture(event, properties ?? undefined, options)
            : fixture.capture(event, properties ?? undefined)
    const get = client.kv.get.bind(client.kv)
    client.kv.get = ((key: string) =>
        key === '$surveys'
            ? fixture.getCachedSurveys()
            : key === '$stored_person_properties'
              ? fixture.storedPersonProperties
              : get(key)) as typeof client.kv.get
    const flags = {
        get hasLoadedFlags() {
            return fixture.hasLoadedFlags
        },
        onFeatureFlags: (callback: () => void) => fixture.onFlags(callback),
        getFeatureFlag: (...args: Parameters<SurveyFixtureOptions['getFlag']>) => fixture.getFlag(...args),
        isFeatureEnabled: (...args: Parameters<SurveyFixtureOptions['isFlagEnabled']>) =>
            fixture.isFlagEnabled(...args),
        reloadFeatureFlags: () => fixture.reloadFlags(),
    }
    Object.defineProperty(client, 'getExtension', { value: () => flags })
    return Object.assign(fixture, {
        client,
        config: {
            disableSurveys: false,
            cookielessMode: false,
            advancedEnableSurveys: false,
            requestTimeoutMs: 10000,
            get prefillFromUrl() {
                return fixture.prefillFromUrl
            },
            get automaticDisplay() {
                return fixture.automaticDisplay
            },
            get featureFlagEvaluation() {
                return fixture.featureFlagEvaluation
            },
            get overrideLanguage() {
                return fixture.overrideLanguage
            },
            get prepareStylesheet() {
                return fixture.prepareStylesheet
            },
            get_current_url: (url: string) => fixture.getTargetingUrl() ?? url,
        },
        surveys: {
            get _surveyEventReceiver() {
                return fixture.eventReceiver
            },
            getSurveys: (...args: [SurveyCallback, boolean?]) => fixture.getSurveys(...args),
        },
    })
}
