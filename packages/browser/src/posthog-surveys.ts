import {
    LOAD_EXT_NOT_FOUND,
    SURVEYS,
    SURVEYS_CACHE_TTL_MS,
    SURVEYS_LOADED_AT,
    SURVEYS_REFRESH_BACKOFF_MS,
} from './constants'

const SURVEY_NOT_LOADED = 'SDK is not enabled or survey functionality is not yet loaded'
const SURVEY_DISABLED = 'Disabled. Not loading surveys.'
import { SurveyManager } from './extensions/surveys'
import type { Extension } from './extensions/types'
import { PostHog } from './posthog-core'
import {
    DisplaySurveyOptions,
    DisplaySurveyType,
    Survey,
    SurveyCallback,
    SurveyRenderReason,
} from './posthog-surveys-types'
import { Properties, RemoteConfigResult } from './types'
import { document } from '@posthog/browser-common/utils/globals'
import { assignableWindow } from './utils/globals'
import { SurveyEventReceiver } from './utils/survey-event-receiver'
import {
    doesSurveyActivateByAction,
    doesSurveyActivateByEvent,
    IN_APP_SURVEY_TYPES,
    isSurveyRunning,
    setSurveySeenOnLocalStorage,
    SURVEY_LOGGER as logger,
    SURVEY_IN_PROGRESS_PREFIX,
    SURVEY_SEEN_PREFIX,
} from './utils/survey-utils'
import { isNullish, isUndefined, isArray, isNumber } from '@posthog/core'

export class PostHogSurveys implements Extension {
    // this is set to undefined until the remote config is loaded
    // then it's set to true if there are surveys to load
    // or false if there are no surveys to load
    // or false if the surveys feature is disabled in the project settings
    private _isSurveysEnabled?: boolean = undefined
    public _surveyEventReceiver: SurveyEventReceiver | null
    private _surveyManager: SurveyManager | null = null
    private _isInitializingSurveys: boolean = false
    private _surveyCallbacks: SurveyCallback[] = []
    // Promise for in-flight survey fetch - allows multiple callers to await the same request
    private _getSurveysInFlightPromise: Promise<{
        surveys: Survey[]
        context: { isLoaded: boolean; error?: string }
    }> | null = null
    // Backs off the stale-cache refresh for one TTL after a failure, so a surveys-API outage can't
    // turn the ~1s display poll into a per-poll request storm.
    private _lastSurveyRefreshFailedAt: number | null = null

    private get _config() {
        return this._instance.config
    }

    constructor(private readonly _instance: PostHog) {
        // we set this to undefined here because we need the persistence storage for this type
        // but that's not initialized until loadIfEnabled is called.
        this._surveyEventReceiver = null
    }

    initialize() {
        this.loadIfEnabled()
    }

    onRemoteConfig(result: RemoteConfigResult) {
        // only load surveys if they are enabled and there are surveys to load
        if (this._config.disable_surveys) {
            return
        }

        if (!result.ok) {
            // Failure behaves like a response without a surveys key: not loaded.
            return logger.warn('Remote config unavailable. Not loading surveys.')
        }

        const surveys = result.config['surveys']
        if (isNullish(surveys)) {
            return logger.warn('Flags not loaded yet. Not loading surveys.')
        }
        const isArrayResponse = isArray(surveys)
        this._isSurveysEnabled = isArrayResponse ? surveys.length > 0 : surveys
        logger.info(`flags response received, isSurveysEnabled: ${this._isSurveysEnabled}`)
        this.loadIfEnabled()
    }

    reset(): void {
        try {
            // Drop in-memory event/action activations too; they aren't in persistence (which
            // reset() has already cleared), so without this an armed-but-unshown survey would
            // survive a logout/account switch that doesn't reload the page.
            this._surveyEventReceiver?.reset()
            localStorage.removeItem('lastSeenSurveyDate')
            const surveyKeys = []
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i)
                if (key?.startsWith(SURVEY_SEEN_PREFIX) || key?.startsWith(SURVEY_IN_PROGRESS_PREFIX)) {
                    surveyKeys.push(key)
                }
            }

            surveyKeys.forEach((key) => localStorage.removeItem(key))
        } catch {
            // localStorage is not always available (e.g. in cross-origin iframes); resetting survey state is best-effort.
        }
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
        if (this._config.disable_surveys) {
            logger.info(SURVEY_DISABLED)
            return
        }
        if (this._config.cookieless_mode && this._instance.consent.isOptedOut()) {
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
        if (isUndefined(this._isSurveysEnabled) && !this._config.advanced_enable_surveys) {
            return
        }

        const isSurveysEnabled = this._isSurveysEnabled || this._config.advanced_enable_surveys

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
                this._handleSurveyLoadError(LOAD_EXT_NOT_FOUND)
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
        if (this._config.disable_surveys) {
            logger.info(SURVEY_DISABLED)
            return callback([])
        }

        const existingSurveys = this._instance.get_property(SURVEYS)
        if (existingSurveys && !forceReload) {
            // Serve the cached definitions synchronously so callers that rely on a synchronous
            // callback (e.g. _getSurveyById) keep working.
            callback(existingSurveys, {
                isLoaded: true,
            })
            // If the cache has aged past its TTL, kick off a background refresh so server-side
            // changes (e.g. a survey switched from popover to API) reach a long-lived tab. The
            // next poll then evaluates the refreshed definitions.
            if (this._shouldBackgroundRefreshSurveys()) {
                this.getSurveys(() => {}, true)
            }
            return
        }

        // If a fetch is already in progress and Promise is available, reuse that promise
        // In browsers without Promise (IE11), we skip this optimization and just make concurrent requests
        if (typeof Promise !== 'undefined' && this._getSurveysInFlightPromise) {
            this._getSurveysInFlightPromise.then(({ surveys, context }) => callback(surveys, context))
            return
        }

        // Create a new promise for this fetch that other callers can reuse
        // We need to assign the promise before starting the request, because
        // in tests (and potentially in some edge cases) the callback may fire synchronously
        let resolvePromise: (value: { surveys: Survey[]; context: { isLoaded: boolean; error?: string } }) => void
        if (typeof Promise !== 'undefined') {
            this._getSurveysInFlightPromise = new Promise((resolve) => {
                resolvePromise = resolve
            })
        }

        this._instance._send_request({
            url: this._instance.requestRouter.endpointFor('api', `/api/surveys/?token=${this._config.token}`),
            method: 'GET',
            timeout: this._config.surveys_request_timeout_ms,
            callback: (response) => {
                this._getSurveysInFlightPromise = null

                const statusCode = response.statusCode
                if (statusCode !== 200 || !response.json) {
                    const error = `Surveys API could not be loaded, status: ${statusCode}`
                    logger.error(error)
                    this._lastSurveyRefreshFailedAt = Date.now()
                    const context = { isLoaded: false, error }
                    callback([], context)
                    resolvePromise?.({ surveys: [], context })
                    return
                }
                this._lastSurveyRefreshFailedAt = null
                const surveys = response.json.surveys || []

                const eventOrActionBasedSurveys = surveys.filter(
                    (survey: Survey) =>
                        isSurveyRunning(survey) &&
                        (doesSurveyActivateByEvent(survey) || doesSurveyActivateByAction(survey))
                )

                if (eventOrActionBasedSurveys.length > 0) {
                    this._surveyEventReceiver?.register(eventOrActionBasedSurveys)
                }

                // Stamp when these definitions were fetched so the split-storage
                // loader can tell a fresher main-blob write-back from a stale
                // `__surveys` entry (the survey analogue of $feature_flag_evaluated_at).
                this._instance.persistence?.register({ [SURVEYS]: surveys, [SURVEYS_LOADED_AT]: Date.now() })
                const context = { isLoaded: true }
                callback(surveys, context)
                resolvePromise?.({ surveys, context })
            },
        })
    }

    /**
     * Whether to kick off a background refresh of the cached definitions: the cache is stale, no
     * fetch is already in flight, and we're not backing off after a recent failure.
     */
    private _shouldBackgroundRefreshSurveys(): boolean {
        return this._isSurveyCacheStale() && !this._getSurveysInFlightPromise && !this._isSurveyRefreshBackingOff()
    }

    /**
     * Whether the cached `$surveys` definitions have aged past their TTL. Returns false when no
     * timestamp is recorded (e.g. surveys injected directly in tests) so the cache stays valid.
     */
    private _isSurveyCacheStale(): boolean {
        const surveysLoadedAt = this._instance.get_property(SURVEYS_LOADED_AT)
        return isNumber(surveysLoadedAt) && Date.now() - surveysLoadedAt > SURVEYS_CACHE_TTL_MS
    }

    private _isSurveyRefreshBackingOff(): boolean {
        return (
            isNumber(this._lastSurveyRefreshFailedAt) &&
            Date.now() - this._lastSurveyRefreshFailedAt < SURVEYS_REFRESH_BACKOFF_MS
        )
    }

    /**
     * Marks a survey as seen for the current device, mirroring the local state the SDK records
     * when it shows or sends a survey itself.
     *
     * Use this when you display surveys through your own backend/integration (so the SDK never
     * captures the `survey shown`/`sent`/`dismissed` events) and still want PostHog's display
     * logic to honour the "already seen" and wait-period checks on subsequent page loads.
     *
     * Note: surveys configured to repeat (`schedule: 'always'` or event `repeatedActivation`)
     * intentionally bypass the seen check, so marking them as seen will not stop them showing.
     *
     * @param surveyId The ID of the survey to mark as seen.
     * @param options Optional settings. `iteration` is the survey's current iteration number, if any.
     */
    markSurveyAsSeen(surveyId: string, options?: { iteration?: number | null }): void {
        const survey = { id: surveyId, current_iteration: options?.iteration ?? null }
        setSurveySeenOnLocalStorage(survey)
        try {
            localStorage.setItem('lastSeenSurveyDate', new Date().toISOString())
        } catch {
            // localStorage is not always available (e.g. in cross-origin iframes); best-effort only.
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
            return { eligible: false, reason: SURVEY_NOT_LOADED }
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
            return { visible: false, disabledReason: SURVEY_NOT_LOADED }
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
                disabledReason: SURVEY_NOT_LOADED,
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

    renderSurvey(surveyId: string | Survey, selector: string, properties?: Properties) {
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
                this._surveyManager?.renderSurvey(survey, elem, properties)
                logger.info(`Survey ${survey.id} rendered`)
            }, survey.appearance.surveyPopupDelaySeconds * 1000)
            return
        }
        this._surveyManager.renderSurvey(survey, elem, properties)
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
        if (options.displayType !== DisplaySurveyType.Popover && options.initialResponses) {
            logger.warn('initialResponses is only supported for popover surveys. prefill will not be applied.')
        }
        if (options.ignoreConditions === false) {
            const canRender = this.canRenderSurvey(survey)
            if (!canRender.visible) {
                logger.warn('Survey is not eligible to be displayed: ', canRender.disabledReason)
                return
            }
        }
        if (options.displayType === DisplaySurveyType.Inline) {
            this.renderSurvey(surveyToDisplay, options.selector, options.properties)
            return
        }
        this._surveyManager.handlePopoverSurvey(surveyToDisplay, options)
    }

    cancelPendingSurvey(surveyId: string): void {
        if (isNullish(this._surveyManager)) {
            logger.warn('init was not called')
            return
        }
        this._surveyManager.cancelSurvey(surveyId)
    }

    handlePageUnload(): void {
        this._surveyManager?.handlePageUnload?.()
    }
}
