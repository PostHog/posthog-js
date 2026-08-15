import type { ApiResponse, Client, DeepReadonly, Disposable, Extension, SendRequestInit } from '@posthog/browser-common'
import { document } from '@posthog/browser-common/utils/globals'
import { continueWith } from '@posthog/browser-common/utils/promise-utils'
import { isBoolean, isNullish, isUndefined, isNumber } from '@posthog/core'

import {
    LOAD_EXT_NOT_FOUND,
    SURVEYS,
    SURVEYS_CACHE_TTL_MS,
    SURVEYS_LOADED_AT,
    SURVEYS_REFRESH_BACKOFF_MS,
} from './constants'
import type { SurveyManager } from './extensions/surveys'
import {
    DisplaySurveyOptions,
    DisplaySurveyType,
    Survey,
    SurveyCallback,
    SurveyRenderReason,
} from './posthog-surveys-types'
import type { SurveysConfigSource, SurveysExtensionHost } from './surveys-config'
import { Properties, RemoteConfigResult } from './types'
import type { SurveyEventReceiver } from './utils/survey-event-receiver'
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

const SURVEY_NOT_LOADED = 'SDK is not enabled or survey functionality is not yet loaded'
const SURVEY_DISABLED = 'Disabled. Not loading surveys.'

export type SurveyFetchResult = {
    surveys: Survey[]
    context?: { isLoaded: boolean; error?: string }
}

type SurveysClientState = Pick<Client, 'projectToken' | 'kv'>

export class PostHogSurveys implements Extension {
    readonly name = 'surveys'
    // this is set to undefined until the remote config is loaded
    // then it's set to true if there are surveys to load
    // or false if there are no surveys to load
    // or false if the surveys feature is disabled in the project settings
    private _isSurveysEnabled?: boolean
    public _surveyEventReceiver: SurveyEventReceiver | null = null
    private _surveyManager: SurveyManager | null = null
    private _isInitializingSurveys = false
    private _surveyCallbacks: SurveyCallback[] = []
    // Promise for in-flight survey fetch - allows multiple callers to await the same request
    private _getSurveysInFlightPromise: Promise<SurveyFetchResult> | null = null
    // Backs off the stale-cache refresh for one TTL after a failure, so a surveys-API outage can't
    // turn the ~1s display poll into a per-poll request storm.
    private _lastSurveyRefreshFailedAt: number | null = null
    private _client?: Client
    private _initializingClient?: Client
    private _remoteConfigSubscription?: Disposable
    private _disposed = false
    private _renderTimeouts = new Set<ReturnType<typeof setTimeout>>()
    constructor(
        private readonly _configSource: SurveysConfigSource,
        private readonly _initialClientState?: SurveysClientState
    ) {}

    setup(client: Client): void | Promise<void> {
        if (this._disposed) {
            return
        }
        this._initializingClient = client
        return continueWith(client.kv.initialize(), () => {
            if (this._initializingClient !== client || this._disposed) {
                return
            }
            this._initializingClient = undefined
            this._client = client
            const subscription = client.onRemoteConfig(this.onRemoteConfig)
            if (this._disposed) {
                subscription.dispose()
                return
            }
            this._remoteConfigSubscription = subscription
            this.loadIfEnabled()
        })
    }

    dispose(): void {
        if (this._disposed) {
            return
        }
        this._disposed = true
        this._initializingClient = undefined
        this._client = undefined
        this._remoteConfigSubscription?.dispose()
        this._remoteConfigSubscription = undefined
        this._surveyEventReceiver?.dispose()
        this._surveyEventReceiver = null
        this._surveyManager?.dispose?.()
        this._surveyManager = null
        this._surveyCallbacks = []
        this._getSurveysInFlightPromise = null
        this._renderTimeouts.forEach((timeout) => clearTimeout(timeout))
        this._renderTimeouts.clear()
    }

    private get _config() {
        return this._configSource.get()
    }

    initialize() {
        this.loadIfEnabled()
    }

    onRemoteConfig = (result: DeepReadonly<RemoteConfigResult>): void => {
        if (this._disposed) {
            return
        }
        // only load surveys if they are enabled and there are surveys to load
        if (this._config.disableSurveys) {
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
        this._isSurveysEnabled = isBoolean(surveys) ? surveys : surveys.length > 0
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
        if (this._disposed || !this._client) {
            return
        }
        const config = this._config
        // Initial guard clauses
        if (this._surveyManager) {
            return
        } // Already loaded
        if (this._isInitializingSurveys) {
            logger.info('Already initializing surveys, skipping...')
            return
        }
        if (config.disableSurveys) {
            logger.info(SURVEY_DISABLED)
            return
        }
        if (config.cookielessMode && this._configSource.isOptedOut()) {
            logger.info('Not loading surveys in cookieless mode without consent.')
            return
        }

        const phExtensions = this._configSource.getExtensions()
        if (!phExtensions) {
            logger.error('PostHog Extensions not found.')
            return
        }

        // waiting for remote config to load
        // if surveys is forced enable (like external surveys), ignore the remote config and load surveys
        if (isUndefined(this._isSurveysEnabled) && !config.advancedEnableSurveys) {
            return
        }

        const isSurveysEnabled = this._isSurveysEnabled || config.advancedEnableSurveys

        this._isInitializingSurveys = true

        try {
            const generateSurveys = phExtensions.generateSurveys
            if (generateSurveys) {
                // Surveys code is already loaded
                this._completeSurveyInitialization(generateSurveys, isSurveysEnabled)
                this._isInitializingSurveys = false
                return
            }

            // If we reach here, surveys code is not loaded yet
            const loadExternalDependency = phExtensions.loadExternalDependency
            if (!loadExternalDependency) {
                // Cannot load surveys code
                this._handleSurveyLoadError(LOAD_EXT_NOT_FOUND)
                this._isInitializingSurveys = false
                return
            }

            // Keep the initialization guard active until the dependency callback completes.
            loadExternalDependency((err) => {
                try {
                    if (this._disposed) {
                        return
                    }
                    const loadedExtensions = this._configSource.getExtensions()
                    if (err || !loadedExtensions?.generateSurveys) {
                        this._handleSurveyLoadError('Could not load surveys script', err)
                    } else {
                        // Need to get the function reference again inside the callback
                        this._completeSurveyInitialization(loadedExtensions.generateSurveys, isSurveysEnabled)
                    }
                } finally {
                    this._isInitializingSurveys = false
                }
            })
        } catch (e) {
            this._isInitializingSurveys = false
            this._handleSurveyLoadError('Error initializing surveys', e)
            throw e
        }
    }

    /** Helper to finalize survey initialization */
    private _completeSurveyInitialization(
        generateSurveysFn: NonNullable<SurveysExtensionHost['generateSurveys']>,
        isSurveysEnabled: boolean
    ): void {
        if (this._disposed) {
            return
        }
        this._surveyManager = generateSurveysFn(isSurveysEnabled)
        this._surveyEventReceiver = this._configSource.createEventReceiver()
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

    getSurveys(callback: SurveyCallback, forceReload = false): void {
        const client = this._client ?? this._initialClientState
        if (!client || this._disposed) {
            return
        }
        if (this._config.disableSurveys) {
            logger.info(SURVEY_DISABLED)
            return callback([])
        }

        const surveys = client.kv.get<Survey[]>(SURVEYS)
        if (surveys && !forceReload) {
            callback(surveys, { isLoaded: true })
            if (this._shouldBackgroundRefreshSurveys()) {
                this.getSurveys(() => {}, true)
            }
            return
        }

        if (this._getSurveysInFlightPromise) {
            void this._getSurveysInFlightPromise
                .then(({ surveys, context }) => {
                    if (!this._disposed) {
                        callback(surveys, context)
                    }
                })
                .catch((error) => logger.error('Error in survey callback', error))
            return
        }

        const request = this._sendSurveysRequest('/api/surveys/', {
            method: 'GET',
            query: { token: client.projectToken },
            sentAt: 'query',
            timeoutMs: this._config.requestTimeoutMs,
        }).then(
            (response) => {
                try {
                    return this._handleSurveyResponse(client, response)
                } catch (error) {
                    logger.error('Error processing surveys response', error)
                    return this._handleSurveyResponse(client, { statusCode: 0, error })
                }
            },
            (error) => this._handleSurveyResponse(client, { statusCode: 0, error })
        )
        this._getSurveysInFlightPromise = request

        const clearInFlight = (): void => {
            if (this._getSurveysInFlightPromise === request) {
                this._getSurveysInFlightPromise = null
            }
        }
        void request
            .then((result) => {
                clearInFlight()
                if (!this._disposed) {
                    callback(result.surveys, result.context)
                }
            }, clearInFlight)
            .catch((error) => logger.error('Error in survey callback', error))
    }

    protected _sendSurveysRequest(path: string, init: SendRequestInit): Promise<ApiResponse> {
        const client = this._client
        if (!client) {
            return new Promise((resolve) => resolve({ statusCode: 0, error: new Error(SURVEY_NOT_LOADED) }))
        }
        return client.sendRequest(path, init)
    }

    private _handleSurveyResponse(client: SurveysClientState, response: ApiResponse): SurveyFetchResult {
        if (this._disposed) {
            return { surveys: [], context: { isLoaded: false, error: SURVEY_NOT_LOADED } }
        }

        const statusCode = response.statusCode
        if (statusCode !== 200 || !response.json) {
            const error = `Surveys API could not be loaded, status: ${statusCode}`
            if (statusCode !== 0) {
                logger.error(error)
            } else if (!response.error) {
                logger.warn(error)
            }
            this._lastSurveyRefreshFailedAt = Date.now()
            return { surveys: [], context: { isLoaded: false, error } }
        }

        this._lastSurveyRefreshFailedAt = null
        const surveys = (response.json as { surveys?: Survey[] }).surveys || []
        const eventOrActionBasedSurveys = surveys.filter(
            (survey) =>
                isSurveyRunning(survey) && (doesSurveyActivateByEvent(survey) || doesSurveyActivateByAction(survey))
        )
        this._surveyEventReceiver?.replace(eventOrActionBasedSurveys)

        // Stamp when these definitions were fetched so the split-storage loader can tell a fresher
        // main-blob write-back from a stale `__surveys` entry.
        client.kv.set({ [SURVEYS]: surveys, [SURVEYS_LOADED_AT]: Date.now() })
        return { surveys, context: { isLoaded: true } }
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
        const surveysLoadedAt = (this._client ?? this._initialClientState)?.kv.get(SURVEYS_LOADED_AT)
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

    private _checkSurveyRenderability(surveyId: string | Survey): { eligible: boolean; reason?: string } {
        if (isNullish(this._surveyManager)) {
            return { eligible: false, reason: SURVEY_NOT_LOADED }
        }
        const survey = typeof surveyId === 'string' ? this._getSurveyById(surveyId) : surveyId
        if (!survey) {
            return { eligible: false, reason: 'Survey not found' }
        }
        return this._surveyManager.checkSurveyRenderability(survey)
    }

    canRenderSurvey(surveyId: string | Survey): SurveyRenderReason {
        if (isNullish(this._surveyManager)) {
            logger.warn('init was not called')
            return { visible: false, disabledReason: SURVEY_NOT_LOADED }
        }
        const eligibility = this._checkSurveyRenderability(surveyId)

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
                    const eligibility = this._checkSurveyRenderability(survey)
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
            const timeout = setTimeout(() => {
                this._renderTimeouts.delete(timeout)
                if (this._disposed) {
                    return
                }
                logger.info(
                    `Rendering survey ${survey.id} with delay of ${survey.appearance?.surveyPopupDelaySeconds} seconds`
                )
                this._surveyManager?.renderSurvey(survey, elem, properties)
                logger.info(`Survey ${survey.id} rendered`)
            }, survey.appearance.surveyPopupDelaySeconds * 1000)
            this._renderTimeouts.add(timeout)
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
            // Explicit display goes through eligibility only, not renderability: the event/action
            // trigger state lives in memory and is irrelevant when the caller asks to show the survey.
            const eligibility = this._checkSurveyEligibility(survey)
            if (!eligibility.eligible) {
                logger.warn('Survey is not eligible to be displayed: ', eligibility.reason)
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
