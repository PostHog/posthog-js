import { getSurveyRenderContext } from '../../browser-surveys'
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { detectUserLanguage } from '@posthog/browser-common/surveys/survey-translations'
import { PostHog } from '../../posthog-core'
import { STORED_PERSON_PROPERTIES_KEY } from '../../constants'
import Config from '../../config'
import * as commonGlobals from '@posthog/browser-common/utils/globals'

describe('Survey Translations', () => {
    let mockPostHog: PostHog
    const originalLanguage = commonGlobals.navigator?.language
    const setBrowserLanguage = (language: string | undefined): void => {
        if (commonGlobals.navigator) {
            Object.defineProperty(commonGlobals.navigator, 'language', {
                value: language,
                writable: true,
                configurable: true,
            })
        }
    }

    beforeEach(() => {
        mockPostHog = {
            get_property: vi.fn(),
            config: {},
        } as unknown as PostHog
        setBrowserLanguage(undefined)
    })

    afterEach(() => {
        Config.DEBUG = false
        setBrowserLanguage(originalLanguage)
    })

    describe('detectUserLanguage', () => {
        it.each([
            {
                name: 'prioritizes config.override_display_language over all other sources',
                configLanguage: 'de',
                browserLanguage: 'fr',
                storedPersonProperties: { language: 'es' },
                expectedLanguage: 'de',
                expectsStoredPropertiesLookup: true,
            },
            {
                name: 'uses person property language when config override is not set',
                configLanguage: null,
                browserLanguage: 'fr',
                storedPersonProperties: { language: 'es' },
                expectedLanguage: 'es',
                expectsStoredPropertiesLookup: true,
            },
            {
                name: 'falls back to browser language when config and person language are not available',
                configLanguage: null,
                browserLanguage: 'fr',
                storedPersonProperties: { some_other_property: 'value' },
                expectedLanguage: 'fr',
                expectsStoredPropertiesLookup: true,
            },
            {
                name: 'returns null when no language source is available',
                configLanguage: null,
                browserLanguage: undefined,
                storedPersonProperties: { some_other_property: 'value' },
                expectedLanguage: null,
                expectsStoredPropertiesLookup: true,
            },
            {
                name: 'trims whitespace from person property language value',
                configLanguage: null,
                browserLanguage: undefined,
                storedPersonProperties: { language: '  es  ' },
                expectedLanguage: 'es',
                expectsStoredPropertiesLookup: true,
            },
            {
                name: 'returns null for empty string person property language',
                configLanguage: null,
                browserLanguage: undefined,
                storedPersonProperties: { language: '   ' },
                expectedLanguage: null,
                expectsStoredPropertiesLookup: true,
            },
            {
                name: 'handles non-string person property language values',
                configLanguage: null,
                browserLanguage: undefined,
                storedPersonProperties: { language: 123 },
                expectedLanguage: null,
                expectsStoredPropertiesLookup: true,
            },
            {
                name: 'falls back to browser language when get_property is not available',
                configLanguage: null,
                browserLanguage: 'pt-BR',
                storedPersonProperties: undefined,
                expectedLanguage: 'pt-BR',
                expectsStoredPropertiesLookup: false,
                hasGetProperty: false,
            },
        ])(
            '$name',
            ({
                configLanguage,
                browserLanguage,
                storedPersonProperties,
                expectedLanguage,
                expectsStoredPropertiesLookup,
                hasGetProperty = true,
            }) => {
                mockPostHog.config.override_display_language = configLanguage
                setBrowserLanguage(browserLanguage)

                mockPostHog.persistence = { get_property: (key: string) => mockPostHog.get_property?.(key) } as any
                if (hasGetProperty) {
                    ;(mockPostHog.get_property as vi.Mock).mockReturnValue(storedPersonProperties)
                } else {
                    delete (mockPostHog as Partial<PostHog>).get_property
                }

                expect(detectUserLanguage(getSurveyRenderContext(mockPostHog)!)).toBe(expectedLanguage)

                if (expectsStoredPropertiesLookup) {
                    expect(mockPostHog.get_property).toHaveBeenCalledWith(STORED_PERSON_PROPERTIES_KEY)
                } else if (hasGetProperty) {
                    expect(mockPostHog.get_property).not.toHaveBeenCalled()
                }
            }
        )

        it('calls get_property with the PostHog instance as context', () => {
            mockPostHog = {
                config: {},
                persistence: {
                    get_property(key: string) {
                        return this.props[key]
                    },
                    props: {
                        [STORED_PERSON_PROPERTIES_KEY]: { language: 'it' },
                    },
                },
                get_property(propertyName: string) {
                    return this.persistence.props[propertyName]
                },
            } as unknown as PostHog

            expect(detectUserLanguage(getSurveyRenderContext(mockPostHog)!)).toBe('it')
        })
    })
})
