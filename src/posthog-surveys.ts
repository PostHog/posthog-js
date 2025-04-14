import { SURVEYS } from './constants'
import { getSurveySeenStorageKeys } from './extensions/surveys/surveys-extension-utils'
import { PostHog } from './posthog-core'
import { Survey, SurveyCallback, SurveyRenderReason } from './posthog-surveys-types'
import { RemoteConfig } from './types'
import { assignableWindow, document } from './utils/globals'
import { SurveyEventReceiver } from './utils/survey-event-receiver'
import {
    doesSurveyActivateByAction,
    doesSurveyActivateByEvent,
    doesSurveyDeviceTypesMatch,
    doesSurveyMatchSelector,
    doesSurveyUrlMatch,
    isSurveyRunning,
    SURVEY_LOGGER as logger,
} from './utils/survey-utils'
import { isArray, isNullish } from './utils/type-utils'

export class PostHogSurveys {
    private _hasSurveys?: boolean
    public _surveyEventReceiver: SurveyEventReceiver | null
    private _surveyManager: any
    private _isFetchingSurveys: boolean = false
    private _isInitializingSurveys: boolean = false
    private _surveyCallbacks: SurveyCallback[] = []

    constructor(private readonly instance: PostHog) {
        // we set this to undefined here because we need the persistence storage for this type
        // but that's not initialized until loadIfEnabled is called.
        this._surveyEventReceiver = null
    }

    onRemoteConfig(response: RemoteConfig) {
        // only load surveys if they are enabled and there are surveys to load
        const surveys = response['surveys']
        if (isNullish(surveys)) {
            return logger.warn('Decide not loaded yet. Not loading surveys.')
        }
        const isArrayResponse = isArray(surveys)
        this._hasSurveys = isArrayResponse ? surveys.length > 0 : surveys
        logger.info(`decide response received, hasSurveys: ${this._hasSurveys}`)
        if (this._hasSurveys) {
            this.loadIfEnabled()
        }
    }

    reset(): void {
        localStorage.removeItem('lastSeenSurveyDate')
        const surveyKeys = getSurveySeenStorageKeys()
        surveyKeys.forEach((key) => localStorage.removeItem(key))
    }

    loadIfEnabled() {
        if (this._surveyManager) {
            // Surveys already loaded.
            return
        }

        if (this._isInitializingSurveys) {
            logger.info('Already initializing surveys, skipping...')
            return
        }

        const disableSurveys = this.instance.config.disable_surveys

        if (disableSurveys) {
            logger.info('Disabled. Not loading surveys.')
            return
        }

        const phExtensions = assignableWindow?.__PosthogExtensions__

        if (!phExtensions) {
            logger.error('PostHog Extensions not found.')
            return
        }

        if (!this._hasSurveys) {
            logger.info('No surveys to load.')
            return
        }

        this._isInitializingSurveys = true

        try {
            const generateSurveys = phExtensions.generateSurveys

            if (!generateSurveys) {
                const loadExternalDependency = phExtensions.loadExternalDependency

                if (loadExternalDependency) {
                    loadExternalDependency(this.instance, 'surveys', (err) => {
                        if (err || !phExtensions.generateSurveys) {
                            logger.error('Could not load surveys script', err)
                            this._isInitializingSurveys = false
                            return
                        }

                        this._surveyManager = phExtensions.generateSurveys(this.instance)
                        this._isInitializingSurveys = false
                        this._surveyEventReceiver = new SurveyEventReceiver(this.instance)
                        logger.info('Surveys loaded successfully')
                        this._notifySurveyCallbacks({
                            isLoaded: true,
                        })
                    })
                } else {
                    const error = 'PostHog loadExternalDependency extension not found. Cannot load remote config.'
                    logger.error(error)
                    this._isInitializingSurveys = false
                    this._notifySurveyCallbacks({
                        isLoaded: false,
                        error,
                    })
                }
            } else {
                this._surveyManager = generateSurveys(this.instance)
                this._isInitializingSurveys = false
                this._surveyEventReceiver = new SurveyEventReceiver(this.instance)
                logger.info('Surveys loaded successfully')
                this._notifySurveyCallbacks({
                    isLoaded: true,
                })
            }
        } catch (e) {
            logger.error('Error initializing surveys', e)
            this._isInitializingSurveys = false
            this._notifySurveyCallbacks({
                isLoaded: false,
                error: 'Error initializing surveys',
            })
            throw e
        }
    }

    /**
     * Register a callback that runs when surveys are initialized.
     * ### Usage:
     *
     *     posthog.onSurveysLoaded((surveys) => {
     *         // You can work with all surveys
     *         console.log('All available surveys:', surveys)
     *
     *         // Or get active matching surveys
     *         posthog.getActiveMatchingSurveys((activeMatchingSurveys) => {
     *             if (activeMatchingSurveys.length > 0) {
     *                 posthog.renderSurvey(activeMatchingSurveys[0].id, '#survey-container')
     *             }
     *         })
     *     })
     *
     * @param {Function} callback The callback function will be called when surveys are loaded or updated.
     *                           It receives the array of all surveys and a context object with error status.
     * @returns {Function} A function that can be called to unsubscribe the listener.
     */
    onSurveysLoaded(callback: SurveyCallback): () => void {
        this._surveyCallbacks.push(callback)

        if (this._surveyManager) {
            this._notifySurveyCallbacks({
                isLoaded: true,
            })
        }
        // Return unsubscribe function
        return () => {
            this._surveyCallbacks = this._surveyCallbacks.filter((cb: SurveyCallback) => cb !== callback)
        }
    }

    getSurveys(callback: SurveyCallback, forceReload = false) {
        // In case we manage to load the surveys script, but config says not to load surveys
        // then we shouldn't return survey data
        if (this.instance.config.disable_surveys) {
            logger.info('Disabled. Not loading surveys.')
            return callback([])
        }

        const existingSurveys = this.instance.get_property(SURVEYS)
        if (existingSurveys && !forceReload) {
            return callback(existingSurveys, {
                isLoaded: true,
            })
        }

        // Prevent concurrent API calls
        if (this._isFetchingSurveys) {
            return callback([], {
                isLoaded: false,
                error: 'Surveys are already being loaded',
            })
        }

        try {
            this._isFetchingSurveys = true
            this.instance._send_request({
                url: this.instance.requestRouter.endpointFor(
                    'api',
                    `/api/surveys/?token=${this.instance.config.token}`
                ),
                method: 'GET',
                timeout: this.instance.config.surveys_request_timeout_ms,
                callback: (response) => {
                    this._isFetchingSurveys = false
                    const statusCode = response.statusCode
                    if (statusCode !== 200 || !response.json) {
                        const error = `Surveys API could not be loaded, status: ${statusCode}`
                        logger.error(error)
                        return callback([], {
                            isLoaded: false,
                            error,
                        })
                    }
                    const surveys = response.json.surveys || []

                    const eventOrActionBasedSurveys = surveys.filter(
                        (survey: Survey) =>
                            isSurveyRunning(survey) &&
                            (doesSurveyActivateByEvent(survey) || doesSurveyActivateByAction(survey))
                    )

                    if (eventOrActionBasedSurveys.length > 0) {
                        this._surveyEventReceiver?.register(eventOrActionBasedSurveys)
                    }

                    this.instance.persistence?.register({ [SURVEYS]: surveys })
                    return callback(surveys, {
                        isLoaded: true,
                    })
                },
            })
        } catch (e) {
            this._isFetchingSurveys = false
            throw e
        }
    }

    /** Helper method to notify all registered callbacks */
    private _notifySurveyCallbacks(context: { isLoaded: boolean; error?: string }): void {
        for (const callback of this._surveyCallbacks) {
            try {
                if (!context.isLoaded) {
                    callback([], context)
                } else {
                    this.getSurveys(callback)
                }
            } catch (error) {
                logger.error('Error in survey callback', error)
            }
        }
    }

    private _isSurveyFeatureFlagEnabled(flagKey: string | null) {
        if (!flagKey) {
            return true
        }
        return !!this.instance.featureFlags.isFeatureEnabled(flagKey)
    }

    private _isSurveyConditionMatched(survey: Survey): boolean {
        if (!survey.conditions) {
            return true
        }
        return doesSurveyUrlMatch(survey) && doesSurveyDeviceTypesMatch(survey) && doesSurveyMatchSelector(survey)
    }

    private _internalFlagCheckSatisfied(survey: Survey): boolean {
        return (
            this._canActivateRepeatedly(survey) || this._isSurveyFeatureFlagEnabled(survey.internal_targeting_flag_key)
        )
    }

    /**
     * Surveys can be activated by events or actions. This method checks if the survey has events and actions,
     * and if so, it checks if the survey has been activated.
     * @param survey
     */
    private _hasActionOrEventTriggeredSurvey(survey: Survey): boolean {
        if (!doesSurveyActivateByEvent(survey) && !doesSurveyActivateByAction(survey)) {
            // If survey doesn't depend on events/actions, it's considered "triggered" by default
            return true
        }
        const surveysActivatedByEventsOrActions: string[] | undefined = this._surveyEventReceiver?.getSurveys()
        return !!surveysActivatedByEventsOrActions?.includes(survey.id)
    }

    getActiveMatchingSurveys(callback: SurveyCallback, forceReload = false) {
        this.getSurveys((surveys) => {
            const targetingMatchedSurveys = surveys.filter((survey) => {
                const eligibility = this.checkSurveyEligibility(survey.id)
                return (
                    eligibility.eligible &&
                    this._isSurveyConditionMatched(survey) &&
                    this._hasActionOrEventTriggeredSurvey(survey) &&
                    this.checkFlags(survey)
                )
            })

            callback(targetingMatchedSurveys)
        }, forceReload)
    }

    checkFlags(survey: Survey): boolean {
        if (!survey.feature_flag_keys?.length) {
            return true
        }

        return survey.feature_flag_keys.every(({ key, value }) => {
            if (!key || !value) {
                return true
            }
            return this.instance.featureFlags.isFeatureEnabled(value)
        })
    }

    // this method is lazily loaded onto the window to avoid loading preact and other dependencies if surveys is not enabled
    private _canActivateRepeatedly(survey: Survey) {
        if (isNullish(assignableWindow.__PosthogExtensions__?.canActivateRepeatedly)) {
            logger.warn('init was not called')
            return false // TODO does it make sense to have a default here?
        }
        return assignableWindow.__PosthogExtensions__.canActivateRepeatedly(survey)
    }

    getSurveyById(surveyId: string): Survey | null {
        let survey: Survey | null = null
        this.getSurveys((surveys) => {
            survey = surveys.find((x) => x.id === surveyId) ?? null
        })
        return survey
    }

    /**
     * Internal check for survey eligibility based on flags and running status.
     * This is used by both getActiveMatchingSurveys and the public canRenderSurvey.
     */
    checkSurveyEligibility(surveyId: string): { eligible: boolean; reason?: string } {
        const survey = typeof surveyId === 'string' ? this.getSurveyById(surveyId) : surveyId
        if (!survey) {
            return { eligible: false, reason: 'Survey not found' }
        }
        const eligibility = { eligible: true, reason: undefined as string | undefined }

        if (!isSurveyRunning(survey)) {
            eligibility.eligible = false
            eligibility.reason = `Survey is not running. It was completed on ${survey.end_date}`
            return eligibility
        }

        if (!this._isSurveyFeatureFlagEnabled(survey.linked_flag_key)) {
            eligibility.eligible = false
            eligibility.reason = `Survey linked feature flag is not enabled`
            return eligibility
        }

        if (!this._isSurveyFeatureFlagEnabled(survey.targeting_flag_key)) {
            eligibility.eligible = false
            eligibility.reason = `Survey targeting feature flag is not enabled`
            return eligibility
        }

        if (!this._internalFlagCheckSatisfied(survey)) {
            eligibility.eligible = false
            eligibility.reason = 'Survey internal targeting flag is not enabled and survey cannot activate repeatedly'
            return eligibility
        }

        return eligibility
    }

    canRenderSurvey(surveyId: string): SurveyRenderReason {
        if (isNullish(this._surveyManager)) {
            logger.warn('init was not called')
            return { visible: false, disabledReason: 'SDK is not enabled or survey functionality is not yet loaded' }
        }
        const eligibility = this.checkSurveyEligibility(surveyId)

        // Translate internal eligibility result to public SurveyRenderReason format
        return { visible: eligibility.eligible, disabledReason: eligibility.reason }
    }

    canRenderSurveyAsync(surveyId: string, forceReload: boolean): Promise<SurveyRenderReason> {
        // Ensure surveys are loaded before checking
        // Using Promise to wrap the callback-based getSurveys method
        // eslint-disable-next-line compat/compat
        return new Promise<SurveyRenderReason>((resolve) => {
            this.getSurveys((surveys) => {
                const survey = surveys.find((x) => x.id === surveyId) ?? null
                if (!survey) {
                    resolve({ visible: false, disabledReason: 'Survey not found' })
                } else {
                    const eligibility = this.checkSurveyEligibility(surveyId)
                    resolve({ visible: eligibility.eligible, disabledReason: eligibility.reason })
                }
            }, forceReload)
        })
    }

    renderSurvey(surveyId: string, selector: string) {
        if (isNullish(this._surveyManager)) {
            logger.warn('init was not called')
            return
        }
        const survey = this.getSurveyById(surveyId)
        if (!survey) {
            logger.warn('Survey not found')
            return
        }

        this._surveyManager.renderSurvey(survey, document?.querySelector(selector))
    }
}
