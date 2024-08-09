import { PostHog } from './posthog-core'
import { DecideResponse } from './types'
import { window } from './utils/globals'
import {
    WebExperiment,
    WebExperimentsCallback,
    WebExperimentTransform,
    WebExperimentUrlMatchType,
    WebExperimentVariant,
} from './web-experiments-types'
import { WEB_EXPERIMENTS } from './constants'
import { isNullish } from './utils/type-utils'
import { isUrlMatchingRegex } from './utils/request-utils'
import { logger } from './utils/logger'

export const webExperimentUrlValidationMap: Record<
    WebExperimentUrlMatchType,
    (conditionsUrl: string, location: Location) => boolean
> = {
    icontains: (conditionsUrl, location) =>
        !!window && location.href.toLowerCase().indexOf(conditionsUrl.toLowerCase()) > -1,
    not_icontains: (conditionsUrl, location) =>
        !!window && location.href.toLowerCase().indexOf(conditionsUrl.toLowerCase()) === -1,
    regex: (conditionsUrl, location) => !!window && isUrlMatchingRegex(location.href, conditionsUrl),
    not_regex: (conditionsUrl, location) => !!window && !isUrlMatchingRegex(location.href, conditionsUrl),
    exact: (conditionsUrl, location) => location.href === conditionsUrl,
    is_not: (conditionsUrl, location) => location.href !== conditionsUrl,
}

export class WebExperiments {
    instance: PostHog
    private _featureFlags?: Record<string, string | boolean>
    private _flagToExperiments?: Map<string, WebExperiment>

    constructor(instance: PostHog) {
        this.instance = instance
        const appFeatureFLags = (flags: string[]) => {
            this.applyFeatureFlagChanges(flags)
        }

        this.instance.onFeatureFlags(appFeatureFLags)
        this._flagToExperiments = new Map<string, WebExperiment>()
    }

    applyFeatureFlagChanges(flags: string[]) {
        WebExperiments.logInfo('applying feature flags', flags)
        if (isNullish(this._flagToExperiments)) {
            return
        }

        flags.forEach((flag) => {
            WebExperiments.logInfo(
                'checking if we know this flag ',
                flag,
                `   this._flagToExperiments is `,
                this._flagToExperiments
            )
            if (this._flagToExperiments && this._flagToExperiments?.has(flag)) {
                const selectedVariant = this.instance.getFeatureFlag(flag) as unknown as string
                const webExperiment = this._flagToExperiments?.get(flag)
                if (selectedVariant && webExperiment?.variants[selectedVariant]) {
                    WebExperiments.applyTransforms(webExperiment.variants[selectedVariant].transforms)
                }
            }
        })
    }

    afterDecideResponse(response: DecideResponse) {
        this._featureFlags = response.featureFlags

        this.loadIfEnabled()
    }

    loadIfEnabled() {
        if (this.instance.config.disable_web_experiments) {
            return
        }

        this.getWebExperimentsAndEvaluateDisplayLogic()
    }

    public getWebExperimentsAndEvaluateDisplayLogic = (forceReload: boolean = false): void => {
        this.getWebExperiments((webExperiments) => {
            // if (isNullish(this._flagToExperiments)) {
            WebExperiments.logInfo(`retrieved web experiments from the server`)
            this._flagToExperiments = new Map<string, WebExperiment>()
            // }

            webExperiments.forEach((webExperiment) => {
                if (
                    webExperiment.feature_flag_key &&
                    this._featureFlags &&
                    this._featureFlags[webExperiment.feature_flag_key]
                ) {
                    if (this._flagToExperiments) {
                        WebExperiments.logInfo(
                            `setting flag key `,
                            webExperiment.feature_flag_key,
                            ` to web experiment `,
                            webExperiment
                        )
                        this._flagToExperiments?.set(webExperiment.feature_flag_key, webExperiment)
                    }

                    const selectedVariant = this._featureFlags[webExperiment.feature_flag_key] as unknown as string
                    if (selectedVariant && webExperiment.variants[selectedVariant]) {
                        WebExperiments.applyTransforms(webExperiment.variants[selectedVariant].transforms)
                    }
                } else if (webExperiment.variants) {
                    for (const variant in webExperiment.variants) {
                        const testVariant = webExperiment.variants[variant]
                        const matchTest = WebExperiments.matchesTestVariant(testVariant)
                        if (matchTest) {
                            WebExperiments.applyTransforms(testVariant.transforms)
                        }
                    }
                }
            })
        }, forceReload)
    }

    public getWebExperiments(callback: WebExperimentsCallback, forceReload: boolean) {
        if (this.instance.config.disable_web_experiments) {
            return callback([])
        }

        const existingWebExperiments = this.instance.get_property(WEB_EXPERIMENTS)
        if (existingWebExperiments && !forceReload) {
            return callback(existingWebExperiments)
        }

        this.instance._send_request({
            url: this.instance.requestRouter.endpointFor(
                'api',
                `/api/experiments/?token=${this.instance.config.token}`
            ),
            method: 'GET',
            transport: 'XHR',
            callback: (response) => {
                if (response.statusCode !== 200 || !response.json) {
                    return callback([])
                }
                const webExperiments = response.json.experiments || []
                return callback(webExperiments)
            },
        })
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
        const location = this.getWindowLocation()
        if (location) {
            // eslint-disable-next-line compat/compat
            const urlParams = new URLSearchParams(location.search)
            let utmCampaignMatched = true
            let utmSourceMatched = true
            let utmMediumMatched = true
            let utmTermMatched = true
            if (testVariant.conditions?.utm?.utm_campaign) {
                utmCampaignMatched = testVariant.conditions?.utm?.utm_campaign == urlParams.get('utm_campaign')
            }

            if (testVariant.conditions?.utm?.utm_source) {
                utmSourceMatched = testVariant.conditions?.utm?.utm_source == urlParams.get('utm_source')
            }

            if (testVariant.conditions?.utm?.utm_campaign) {
                utmMediumMatched = testVariant.conditions?.utm?.utm_medium == urlParams.get('utm_medium')
            }

            if (testVariant.conditions?.utm?.utm_term) {
                utmTermMatched = testVariant.conditions?.utm?.utm_term == urlParams.get('utm_term')
            }

            return utmCampaignMatched && utmMediumMatched && utmTermMatched && utmSourceMatched
        }

        return false
    }

    private static logInfo(...args: any[]) {
        logger.info(`WEB EXPERIMENTS`, args)
    }

    private static applyTransforms(transforms: WebExperimentTransform[]) {
        transforms.forEach((transform) => {
            WebExperiments.logInfo(`applying transform `, transform)
            if (transform.selector) {
                // eslint-disable-next-line no-restricted-globals
                const elements = document?.querySelectorAll(transform.selector)
                elements?.forEach((element) => {
                    WebExperiments.logInfo(
                        `applying transform of text [`,
                        transform.text,
                        `]to element `,
                        element,
                        ` element.nodeType is `,
                        element.nodeType
                    )

                    if (transform.text) {
                        const htmlElement = element as HTMLElement
                        if (htmlElement) {
                            htmlElement.innerText = transform.text
                        }
                    }

                    if (transform.html) {
                        const htmlElement = element as HTMLElement
                        if (htmlElement) {
                            htmlElement.innerHTML = transform.html
                        }
                    }
                    if (transform.className) {
                        const htmlElement = element as HTMLElement
                        htmlElement.className = transform.className
                    }
                })
            }
        })
    }

    private static safeParseJson(payload: string): any | undefined {
        try {
            const parsed = JSON.parse(payload)
            return parsed
        } catch (e) {
            return undefined
        }

        return undefined
    }

    //
    // _isVarianttransform(obj: any): obj is ExperimentVarianttransform {
    //     return obj && typeof obj.name === 'string'
    // }

    //         function isAnimal(obj: any):
    //     obj is Animal {
    //
    // }
}
