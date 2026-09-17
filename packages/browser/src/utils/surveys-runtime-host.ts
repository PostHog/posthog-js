import type { SurveysRuntimeHost, SurveyStorage } from '@posthog/browser-common/surveys-runtime-host'
import type { PostHog } from '../posthog-core'
import { FeatureFlagsExtension } from '../extension-tokens'
import { STORED_PERSON_PROPERTIES_KEY, SURVEYS } from '../constants'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { getTargetingUrl } from '@posthog/browser-common/utils/url-targeting-utils'
import { isCapturingEnabled } from './survey-utils'
import { localStore } from '../storage'

export const surveyStorage: SurveyStorage = {
    getItem: (key) => localStore._get(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
}

export const createSurveysRuntimeHost = (instance?: PostHog): SurveysRuntimeHost => {
    const flags = () => instance?.getExtension?.(FeatureFlagsExtension) ?? instance?.featureFlags
    return {
        get canCapture() {
            return !!instance && isCapturingEnabled(instance)
        },
        get prefillFromUrl() {
            return !!instance?.config?.surveys?.prefillFromUrl
        },
        get automaticDisplay() {
            return !instance?.config?.disable_surveys_automatic_display
        },
        get featureFlagEvaluation() {
            return !instance?.config?.advanced_disable_feature_flags
        },
        get hasLoadedFlags() {
            return !!flags()?.hasLoadedFlags
        },
        get overrideLanguage() {
            return instance?.config?.override_display_language
        },
        get storedPersonProperties() {
            return instance?.get_property?.(STORED_PERSON_PROPERTIES_KEY)
        },
        get eventReceiver() {
            return instance?.surveys?._surveyEventReceiver
        },
        getCachedSurveys: () => instance?.get_property?.(SURVEYS),
        storage: surveyStorage,
        capture: (event, properties, options) => {
            options ? instance?.capture(event, properties, options) : instance?.capture(event, properties)
        },
        getSurveys: (callback, forceReload) => instance?.surveys?.getSurveys(callback, forceReload),
        onFlags: (callback) => instance?.onFeatureFlags(callback) ?? (() => {}),
        getFlag: (key, options) => flags()?.getFeatureFlag(key, options),
        isFlagEnabled: (key, options) => flags()?.isFeatureEnabled(key, options),
        reloadFlags: () => instance?.reloadFeatureFlags(),
        getReplayUrl: () => instance?.get_session_replay_url?.(),
        getTargetingUrl: () => getTargetingUrl(instance),
        get prepareStylesheet() {
            return instance?.config?.prepare_external_dependency_stylesheet
        },
        createSubmissionId: uuidv7,
    }
}
