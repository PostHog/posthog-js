import { PostHog } from './posthog-core'
import { navigator, window } from './utils/globals'
import {
    WebExperiment,
    WebExperimentsCallback,
    WebExperimentTransform,
    WebExperimentUrlMatchType,
    WebExperimentVariant,
} from './web-experiments-types'
import { WEB_EXPERIMENTS } from './constants'
import { isNullish, isString } from './utils/type-utils'
import { getQueryParam } from './utils/request-utils'
import { isMatchingRegex } from './utils/string-utils'
import { logger } from './utils/logger'
import { Info } from './utils/event-utils'
import { isLikelyBot } from './utils/blocked-uas'

export const webExperimentUrlValidationMap: Record<
    WebExperimentUrlMatchType,
    (conditionsUrl: string, location: Location) => boolean
> = {
    icontains: (conditionsUrl, location) =>
        !!window && location.href.toLowerCase().indexOf(conditionsUrl.toLowerCase()) > -1,
    not_icontains: (conditionsUrl, location) =>
        !!window && location.href.toLowerCase().indexOf(conditionsUrl.toLowerCase()) === -1,
    regex: (conditionsUrl, location) => !!window && isMatchingRegex(location.href, conditionsUrl),
    not_regex: (conditionsUrl, location) => !!window && !isMatchingRegex(location.href, conditionsUrl),
    exact: (conditionsUrl, location) => location.href === conditionsUrl,
    is_not: (conditionsUrl, location) => location.href !== conditionsUrl,
}

export class WebExperiments {
    private _flagToExperiments?: Map<string, WebExperiment>

    constructor(private instance: PostHog) {
        this.instance.onFeatureFlags((flags: string[]) => {
            this.onFeatureFlags(flags)
        })
    }

    onFeatureFlags(flags: string[]) {
        if (this._is_bot()) {
            WebExperiments.logInfo('Refusing to render web experiment since the viewer is a likely bot')
            return
        }

        if (this.instance.config.disable_web_experiments) {
            return
        }

        if (isNullish(this._flagToExperiments)) {
            // Indicates first load so we trigger the loaders
            this._flagToExperiments = new Map<string, WebExperiment>()
            this.loadIfEnabled()
            this.previewWebExperiment()
            return
        }

        WebExperiments.logInfo('applying feature flags', flags)
        flags.forEach((flag) => {
            if (this._flagToExperiments && this._flagToExperiments?.has(flag)) {
                const selectedVariant = this.instance.getFeatureFlag(flag) as unknown as string
                const webExperiment = this._flagToExperiments?.get(flag)
                if (selectedVariant && webExperiment?.variants[selectedVariant]) {
                    this.applyTransforms(
                        webExperiment.name,
                        selectedVariant,
                        webExperiment.variants[selectedVariant].transforms
                    )
                }
            }
        })
    }

    previewWebExperiment() {
        const location = WebExperiments.getWindowLocation()
        if (location?.search) {
            const experimentID = getQueryParam(location?.search, '__experiment_id')
            const variant = getQueryParam(location?.search, '__experiment_variant')
            if (experimentID && variant) {
                WebExperiments.logInfo(`previewing web experiments ${experimentID} && ${variant}`)
                this.getWebExperiments(
                    (webExperiments) => {
                        this.showPreviewWebExperiment(parseInt(experimentID), variant, webExperiments)
                    },
                    false,
                    true
                )
            }
        }
    }

    loadIfEnabled() {
        if (this.instance.config.disable_web_experiments) {
            return
        }

        this.getWebExperimentsAndEvaluateDisplayLogic()
    }

    public getWebExperimentsAndEvaluateDisplayLogic = (forceReload: boolean = false): void => {
        this.getWebExperiments((webExperiments) => {
            WebExperiments.logInfo(`retrieved web experiments from the server`)
            this._flagToExperiments = new Map<string, WebExperiment>()

            webExperiments.forEach((webExperiment) => {
                if (webExperiment.feature_flag_key) {
                    if (this._flagToExperiments) {
                        WebExperiments.logInfo(
                            `setting flag key `,
                            webExperiment.feature_flag_key,
                            ` to web experiment `,
                            webExperiment
                        )
                        this._flagToExperiments?.set(webExperiment.feature_flag_key, webExperiment)
                    }

                    const selectedVariant = this.instance.getFeatureFlag(webExperiment.feature_flag_key)
                    if (isString(selectedVariant) && webExperiment.variants[selectedVariant]) {
                        this.applyTransforms(
                            webExperiment.name,
                            selectedVariant,
                            webExperiment.variants[selectedVariant].transforms
                        )
                    }
                } else if (webExperiment.variants) {
                    for (const variant in webExperiment.variants) {
                        const testVariant = webExperiment.variants[variant]
                        const matchTest = WebExperiments.matchesTestVariant(testVariant)
                        if (matchTest) {
                            this.applyTransforms(webExperiment.name, variant, testVariant.transforms)
                        }
                    }
                }
            })
        }, forceReload)
    }

    public getWebExperiments(callback: WebExperimentsCallback, forceReload: boolean, previewing?: boolean) {
        if (this.instance.config.disable_web_experiments && !previewing) {
            return callback([])
        }

        const existingWebExperiments = this.instance.get_property(WEB_EXPERIMENTS)
        if (existingWebExperiments && !forceReload) {
            return callback(existingWebExperiments)
        }

        this.instance._send_request({
            url: this.instance.requestRouter.endpointFor(
                'api',
                `/api/web_experiments/?token=${this.instance.config.token}`
            ),
            method: 'GET',
            callback: (response) => {
                if (response.statusCode !== 200 || !response.json) {
                    return callback([])
                }
                const webExperiments = response.json.experiments || []
                return callback(webExperiments)
            },
        })
    }

    private showPreviewWebExperiment(experimentID: number, variant: string, webExperiments: WebExperiment[]) {
        const previewExperiments = webExperiments.filter((exp) => exp.id === experimentID)
        if (previewExperiments && previewExperiments.length > 0) {
            WebExperiments.logInfo(
                `Previewing web experiment [${previewExperiments[0].name}] with variant [${variant}]`
            )
            this.applyTransforms(
                previewExperiments[0].name,
                variant,
                previewExperiments[0].variants[variant].transforms
            )
        }
    }
    private static matchesTestVariant(testVariant: WebExperimentVariant) {
        if (isNullish(testVariant.conditions)) {
            return false
        }
        return WebExperiments.matchUrlConditions(testVariant) && WebExperiments.matchUTMConditions(testVariant)
    }

    private static matchUrlConditions(testVariant: WebExperimentVariant): boolean {
        if (isNullish(testVariant.conditions) || isNullish(testVariant.conditions?.url)) {
            return true
        }

        const location = WebExperiments.getWindowLocation()
        if (location) {
            const urlCheck = testVariant.conditions?.url
                ? webExperimentUrlValidationMap[testVariant.conditions?.urlMatchType ?? 'icontains'](
                      testVariant.conditions.url,
                      location
                  )
                : true
            return urlCheck
        }

        return false
    }

    public static getWindowLocation(): Location | undefined {
        return window?.location
    }

    private static matchUTMConditions(testVariant: WebExperimentVariant): boolean {
        if (isNullish(testVariant.conditions) || isNullish(testVariant.conditions?.utm)) {
            return true
        }
        const campaignParams = Info.campaignParams()
        if (campaignParams['utm_source']) {
            // eslint-disable-next-line compat/compat
            const utmCampaignMatched = testVariant.conditions?.utm?.utm_campaign
                ? testVariant.conditions?.utm?.utm_campaign == campaignParams['utm_campaign']
                : true

            const utmSourceMatched = testVariant.conditions?.utm?.utm_source
                ? testVariant.conditions?.utm?.utm_source == campaignParams['utm_source']
                : true

            const utmMediumMatched = testVariant.conditions?.utm?.utm_medium
                ? testVariant.conditions?.utm?.utm_medium == campaignParams['utm_medium']
                : true

            const utmTermMatched = testVariant.conditions?.utm?.utm_term
                ? testVariant.conditions?.utm?.utm_term == campaignParams['utm_term']
                : true

            return utmCampaignMatched && utmMediumMatched && utmTermMatched && utmSourceMatched
        }

        return false
    }

    private static logInfo(msg: string, ...args: any[]) {
        logger.info(`[WebExperiments] ${msg}`, args)
    }

    private applyTransforms(experiment: string, variant: string, transforms: WebExperimentTransform[]) {
        if (this._is_bot()) {
            WebExperiments.logInfo('Refusing to render web experiment since the viewer is a likely bot')
            return
        }

        if (variant === 'control') {
            WebExperiments.logInfo('Control variants leave the page unmodified.')
            return
        }

        transforms.forEach((transform) => {
            if (transform.selector) {
                WebExperiments.logInfo(
                    `applying transform of variant ${variant} for experiment ${experiment} `,
                    transform
                )

                // eslint-disable-next-line no-restricted-globals
                const elements = document?.querySelectorAll(transform.selector)
                elements?.forEach((element) => {
                    const htmlElement = element as HTMLElement
                    if (transform.html) {
                        htmlElement.innerHTML = transform.html
                    }

                    if (transform.css) {
                        htmlElement.setAttribute('style', transform.css)
                    }
                })
            }
        })
    }

    _is_bot(): boolean | undefined {
        if (navigator && this.instance) {
            return isLikelyBot(navigator, this.instance.config.custom_blocked_useragents)
        } else {
            return undefined
        }
    }
}
