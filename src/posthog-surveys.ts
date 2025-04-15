import { SURVEYS } from './constants'
import { getSurveySeenStorageKeys } from './extensions/surveys/surveys-extension-utils'
import { PostHog } from './posthog-core'
import { Survey, SurveyCallback, SurveyRenderReason } from './posthog-surveys-types'
import { RemoteConfig } from './types'
import { assignableWindow, document } from './utils/globals'
import { SurveyEventReceiver } from './utils/survey-event-receiver'
import { doesSurveyDeviceTypesMatch, doesSurveyUrlMatch, SURVEY_LOGGER as logger } from './utils/survey-utils'
import { isArray, isNullish } from './utils/type-utils'

export class PostHogSurveys {
    private _hasSurveys?: boolean
    public _surveyEventReceiver: SurveyEventReceiver | null
    private _surveyManager: any
    private _isFetchingSurveys: boolean = false
    private _isInitializingSurveys: boolean = false
    private _surveyCallbacks: SurveyCallback[] = []

    constructor(private readonly _instance: PostHog) {
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
        // Initial guard clauses
        if (this._surveyManager) {
            return
        } // Already loaded
        if (this._isInitializingSurveys) {
            logger.info('Already initializing surveys, skipping...')
            return
        }
        if (this._instance.config.disable_surveys) {
            logger.info('Disabled. Not loading surveys.')
            return
        }
        if (!this._hasSurveys) {
            logger.info('No surveys to load.')
            return
        }

        const phExtensions = assignableWindow?.__PosthogExtensions__
        if (!phExtensions) {
            logger.error('PostHog Extensions not found.')
            return
        }

        this._isInitializingSurveys = true

        try {
            const generateSurveys = phExtensions.generateSurveys
            if (generateSurveys) {
                // Surveys code is already loaded
                this._completeSurveyInitialization(generateSurveys)
                return
            }

            // If we reach here, surveys code is not loaded yet
            const loadExternalDependency = phExtensions.loadExternalDependency
            if (!loadExternalDependency) {
                // Cannot load surveys code
                this._handleSurveyLoadError('PostHog loadExternalDependency extension not found.')
                return
            }

            // If we reach here, we need to load the dependency
            loadExternalDependency(this._instance, 'surveys', (err) => {
                if (err || !phExtensions.generateSurveys) {
                    this._handleSurveyLoadError('Could not load surveys script', err)
                } else {
                    // Need to get the function reference again inside the callback
                    this._completeSurveyInitialization(phExtensions.generateSurveys)
                }
            })
        } catch (e) {
            this._handleSurveyLoadError('Error initializing surveys', e)
            throw e
        } finally {
            // Ensure the flag is always reset
            this._isInitializingSurveys = false
        }
    }

    /** Helper to finalize survey initialization */
    private _completeSurveyInitialization(generateSurveysFn: (instance: PostHog) => any): void {
        this._surveyManager = generateSurveysFn(this._instance)
        this._surveyEventReceiver = new SurveyEventReceiver(this._instance)
        logger.info('Surveys loaded successfully')
        this._notifySurveyCallbacks({ isLoaded: true })
    }

    /** Helper to handle errors during survey loading */
    private _handleSurveyLoadError(message: string, error?: any): void {
        logger.error(message, error)
        this._notifySurveyCallbacks({ isLoaded: false, error: message })
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
        if (this._instance.config.disable_surveys) {
            logger.info('Disabled. Not loading surveys.')
            return callback([])
        }

        const existingSurveys = this._instance.get_property(SURVEYS)

        if (!existingSurveys || forceReload) {
            // Prevent concurrent API calls
            if (this._isFetchingSurveys) {
                return callback([], {
                    isLoaded: false,
                    error: 'Surveys are already being loaded',
                })
            }

            try {
                this._isFetchingSurveys = true
                this._instance._send_request({
                    url: this._instance.requestRouter.endpointFor(
                        'api',
                        `/api/surveys/?token=${this._instance.config.token}`
                    ),
                    method: 'GET',
                    timeout: this._instance.config.surveys_request_timeout_ms,
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
                                (survey.conditions?.events &&
                                    survey.conditions?.events?.values &&
                                    survey.conditions?.events?.values?.length > 0) ||
                                (survey.conditions?.actions &&
                                    survey.conditions?.actions?.values &&
                                    survey.conditions?.actions?.values?.length > 0)
                        )

                        if (eventOrActionBasedSurveys.length > 0) {
                            this._surveyEventReceiver?.register(eventOrActionBasedSurveys)
                        }

                        this._instance.persistence?.register({ [SURVEYS]: surveys })
                        return callback(surveys, {
                            isLoaded: true,
                        })
                    },
                })
            } catch (e) {
                this._isFetchingSurveys = false
                throw e
            }
        } else {
            return callback(existingSurveys, {
                isLoaded: true,
            })
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
        return this._instance.featureFlags.isFeatureEnabled(flagKey)
    }

    getActiveMatchingSurveys(callback: SurveyCallback, forceReload = false) {
        this.getSurveys((surveys) => {
            const activeSurveys = surveys.filter((survey) => {
                return !!(survey.start_date && !survey.end_date)
            })

            const conditionMatchedSurveys = activeSurveys.filter((survey) => {
                if (!survey.conditions) {
                    return true
                }

                const urlCheck = doesSurveyUrlMatch(survey)
                const selectorCheck = survey.conditions?.selector
                    ? document?.querySelector(survey.conditions.selector)
                    : true
                const deviceTypeCheck = doesSurveyDeviceTypesMatch(survey)
                return urlCheck && selectorCheck && deviceTypeCheck
            })

            // get all the surveys that have been activated so far with user actions.
            const activatedSurveys: string[] | undefined = this._surveyEventReceiver?.getSurveys()
            const targetingMatchedSurveys = conditionMatchedSurveys.filter((survey) => {
                if (
                    !survey.linked_flag_key &&
                    !survey.targeting_flag_key &&
                    !survey.internal_targeting_flag_key &&
                    !survey.feature_flag_keys?.length
                ) {
                    return true
                }
                const linkedFlagCheck = this._isSurveyFeatureFlagEnabled(survey.linked_flag_key)
                const targetingFlagCheck = this._isSurveyFeatureFlagEnabled(survey.targeting_flag_key)

                const hasEvents = (survey.conditions?.events?.values?.length ?? 0) > 0
                const hasActions = (survey.conditions?.actions?.values?.length ?? 0) > 0

                const eventBasedTargetingFlagCheck =
                    hasEvents || hasActions ? activatedSurveys?.includes(survey.id) : true

                const overrideInternalTargetingFlagCheck = this._canActivateRepeatedly(survey)
                const internalTargetingFlagCheck =
                    overrideInternalTargetingFlagCheck ||
                    this._isSurveyFeatureFlagEnabled(survey.internal_targeting_flag_key)

                const flagsCheck = this.checkFlags(survey)
                return (
                    linkedFlagCheck &&
                    targetingFlagCheck &&
                    internalTargetingFlagCheck &&
                    eventBasedTargetingFlagCheck &&
                    flagsCheck
                )
            })

            return callback(targetingMatchedSurveys)
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
            return this._instance.featureFlags.isFeatureEnabled(value)
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

    canRenderSurvey(surveyId: string): SurveyRenderReason | null {
        if (isNullish(this._surveyManager)) {
            logger.warn('init was not called')
            return { visible: false, disabledReason: 'SDK is not enabled or survey functionality is not yet loaded' }
        }
        let renderReason: SurveyRenderReason | null = null
        this.getSurveys((surveys) => {
            const survey = surveys.filter((x) => x.id === surveyId)[0]
            if (survey) {
                renderReason = { ...this._surveyManager.canRenderSurvey(survey) }
            } else {
                renderReason = { visible: false, disabledReason: 'Survey not found' }
            }
        })
        return renderReason
    }

    canRenderSurveyAsync(surveyId: string, forceReload: boolean): Promise<SurveyRenderReason> {
        if (isNullish(this._surveyManager)) {
            logger.warn('init was not called')
            return Promise.resolve({
                visible: false,
                disabledReason: 'SDK is not enabled or survey functionality is not yet loaded',
            })
        }
        // Using Promise to wrap the callback-based getSurveys method
        // eslint-disable-next-line compat/compat
        return new Promise<SurveyRenderReason>((resolve) => {
            this.getSurveys((surveys) => {
                const survey = surveys.filter((x) => x.id === surveyId)[0]
                if (survey) {
                    resolve({ ...this._surveyManager.canRenderSurvey(survey) })
                } else {
                    resolve({ visible: false, disabledReason: 'Survey not found' })
                }
            }, forceReload)
        })
    }

    renderSurvey(surveyId: string, selector: string) {
        if (isNullish(this._surveyManager)) {
            logger.warn('init was not called')
            return
        }
        this.getSurveys((surveys) => {
            const survey = surveys.filter((x) => x.id === surveyId)[0]
            this._surveyManager.renderSurvey(survey, document?.querySelector(selector))
        })
    }
}
