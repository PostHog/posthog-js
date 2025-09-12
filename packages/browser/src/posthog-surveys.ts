import { SURVEYS } from './constants'
import { SurveyManager } from './extensions/surveys'
import { PostHog } from './posthog-core'
import {
    DisplaySurveyOptions,
    DisplaySurveyType,
    Survey,
    SurveyCallback,
    SurveyRenderReason,
} from './posthog-surveys-types'
import { RemoteConfig } from './types'
import { assignableWindow, document } from './utils/globals'
import { SurveyEventReceiver } from './utils/survey-event-receiver'
import {
    doesSurveyActivateByAction,
    doesSurveyActivateByEvent,
    IN_APP_SURVEY_TYPES,
    isSurveyRunning,
    SURVEY_LOGGER as logger,
    SURVEY_IN_PROGRESS_PREFIX,
    SURVEY_SEEN_PREFIX,
} from './utils/survey-utils'
import { isNullish, isUndefined, isArray } from '@posthog/core'

export class PostHogSurveys {
    // this is set to undefined until the remote config is loaded
    // then it's set to true if there are surveys to load
    // or false if there are no surveys to load
    // or false if the surveys feature is disabled in the project settings
    private _isSurveysEnabled?: boolean = undefined
    public _surveyEventReceiver: SurveyEventReceiver | null
    private _surveyManager: SurveyManager | null = null
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
        if (this._instance.config.disable_surveys) {
            return
        }

        const surveys = response['surveys']
        if (isNullish(surveys)) {
            return logger.warn('Flags not loaded yet. Not loading surveys.')
        }
        const isArrayResponse = isArray(surveys)
        this._isSurveysEnabled = isArrayResponse ? surveys.length > 0 : surveys
        logger.info(`flags response received, isSurveysEnabled: ${this._isSurveysEnabled}`)
        this.loadIfEnabled()
    }

    reset(): void {
        localStorage.removeItem('lastSeenSurveyDate')
        const surveyKeys = []
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key?.startsWith(SURVEY_SEEN_PREFIX) || key?.startsWith(SURVEY_IN_PROGRESS_PREFIX)) {
                surveyKeys.push(key)
            }
        }

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
        if (this._instance.config.cookieless_mode && this._instance.consent.isOptedOut()) {
            logger.info('Not loading surveys in cookieless mode without consent.')
            return
        }

        const phExtensions = assignableWindow?.__PosthogExtensions__
        if (!phExtensions) {
            logger.error('PostHog Extensions not found.')
            return
        }

        // waiting for remote config to load
        // if surveys is forced enable (like external surveys), ignore the remote config and load surveys
        if (isUndefined(this._isSurveysEnabled) && !this._instance.config.advanced_enable_surveys) {
            return
        }

        const isSurveysEnabled = this._isSurveysEnabled || this._instance.config.advanced_enable_surveys

        this._isInitializingSurveys = true

        try {
            const generateSurveys = phExtensions.generateSurveys
            if (generateSurveys) {
                // Surveys code is already loaded
                this._completeSurveyInitialization(generateSurveys, isSurveysEnabled)
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
                    this._completeSurveyInitialization(phExtensions.generateSurveys, isSurveysEnabled)
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
    private _completeSurveyInitialization(
        generateSurveysFn: (instance: PostHog, isSurveysEnabled: boolean) => any,
        isSurveysEnabled: boolean
    ): void {
        this._surveyManager = generateSurveysFn(this._instance, isSurveysEnabled)
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
                            isSurveyRunning(survey) &&
                            (doesSurveyActivateByEvent(survey) || doesSurveyActivateByAction(survey))
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
    }

    /** Helper method to notify all registered callbacks */
    private _notifySurveyCallbacks(context: { isLoaded: boolean; error?: string }): void {
        for (const callback of this._surveyCallbacks) {
            try {
                if (!context.isLoaded) {
                    return callback([], context)
                }
                this.getSurveys(callback)
            } catch (error) {
                logger.error('Error in survey callback', error)
            }
        }
    }

    getActiveMatchingSurveys(callback: SurveyCallback, forceReload = false) {
        if (isNullish(this._surveyManager)) {
            logger.warn('init was not called')
            return
        }
        return this._surveyManager.getActiveMatchingSurveys(callback, forceReload)
    }

    private _getSurveyById(surveyId: string): Survey | null {
        let survey: Survey | null = null
        this.getSurveys((surveys) => {
            survey = surveys.find((x) => x.id === surveyId) ?? null
        })
        return survey
    }

    private _checkSurveyEligibility(surveyId: string | Survey): { eligible: boolean; reason?: string } {
        if (isNullish(this._surveyManager)) {
            return { eligible: false, reason: 'SDK is not enabled or survey functionality is not yet loaded' }
        }
        const survey = typeof surveyId === 'string' ? this._getSurveyById(surveyId) : surveyId
        if (!survey) {
            return { eligible: false, reason: 'Survey not found' }
        }
        return this._surveyManager.checkSurveyEligibility(survey)
    }

    canRenderSurvey(surveyId: string | Survey): SurveyRenderReason {
        if (isNullish(this._surveyManager)) {
            logger.warn('init was not called')
            return { visible: false, disabledReason: 'SDK is not enabled or survey functionality is not yet loaded' }
        }
        const eligibility = this._checkSurveyEligibility(surveyId)

        return { visible: eligibility.eligible, disabledReason: eligibility.reason }
    }

    canRenderSurveyAsync(surveyId: string, forceReload: boolean): Promise<SurveyRenderReason> {
        // Ensure surveys are loaded before checking
        // Using Promise to wrap the callback-based getSurveys method
        if (isNullish(this._surveyManager)) {
            logger.warn('init was not called')
            return Promise.resolve({
                visible: false,
                disabledReason: 'SDK is not enabled or survey functionality is not yet loaded',
            })
        }

        // eslint-disable-next-line compat/compat
        return new Promise<SurveyRenderReason>((resolve) => {
            this.getSurveys((surveys) => {
                const survey = surveys.find((x) => x.id === surveyId) ?? null
                if (!survey) {
                    resolve({ visible: false, disabledReason: 'Survey not found' })
                } else {
                    const eligibility = this._checkSurveyEligibility(survey)
                    resolve({ visible: eligibility.eligible, disabledReason: eligibility.reason })
                }
            }, forceReload)
        })
    }

    renderSurvey(surveyId: string | Survey, selector: string) {
        if (isNullish(this._surveyManager)) {
            logger.warn('init was not called')
            return
        }
        const survey = typeof surveyId === 'string' ? this._getSurveyById(surveyId) : surveyId
        if (!survey?.id) {
            logger.warn('Survey not found')
            return
        }
        if (!IN_APP_SURVEY_TYPES.includes(survey.type)) {
            logger.warn(`Surveys of type ${survey.type} cannot be rendered in the app`)
            return
        }
        const elem = document?.querySelector(selector)
        if (!elem) {
            logger.warn('Survey element not found')
            return
        }
        if (survey.appearance?.surveyPopupDelaySeconds) {
            logger.info(
                `Rendering survey ${survey.id} with delay of ${survey.appearance.surveyPopupDelaySeconds} seconds`
            )
            setTimeout(() => {
                logger.info(
                    `Rendering survey ${survey.id} with delay of ${survey.appearance?.surveyPopupDelaySeconds} seconds`
                )
                this._surveyManager?.renderSurvey(survey, elem)
                logger.info(`Survey ${survey.id} rendered`)
            }, survey.appearance.surveyPopupDelaySeconds * 1000)
            return
        }
        this._surveyManager.renderSurvey(survey, elem)
    }

    displaySurvey(surveyId: string, options: DisplaySurveyOptions) {
        if (isNullish(this._surveyManager)) {
            logger.warn('init was not called')
            return
        }
        const survey = this._getSurveyById(surveyId)
        if (!survey) {
            logger.warn('Survey not found')
            return
        }
        let surveyToDisplay = survey
        if (survey.appearance?.surveyPopupDelaySeconds && options.ignoreDelay) {
            surveyToDisplay = {
                ...survey,
                appearance: {
                    ...survey.appearance,
                    surveyPopupDelaySeconds: 0,
                },
            }
        }
        if (options.ignoreConditions === false) {
            const canRender = this.canRenderSurvey(survey)
            if (!canRender.visible) {
                logger.warn('Survey is not eligible to be displayed: ', canRender.disabledReason)
                return
            }
        }
        if (options.displayType === DisplaySurveyType.Inline) {
            this.renderSurvey(surveyToDisplay, options.selector)
            return
        }
        this._surveyManager.handlePopoverSurvey(surveyToDisplay)
    }
}
