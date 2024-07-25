import { PostHog } from './posthog-core'
import { DecideResponse } from './types'
import { window } from './utils/globals'
import {
    WebExperimentsCallback,
    WebExperimentTransform,
    WebExperimentUrlMatchType,
    WebExperimentVariant,
} from './web-experiments-types'
import { WEB_EXPERIMENTS } from './constants'
import { isUndefined } from './utils/type-utils'
import { isUrlMatchingRegex } from './utils/request-utils'

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

    constructor(instance: PostHog) {
        this.instance = instance
    }

    afterDecideResponse(response: DecideResponse) {
        this._featureFlags = response.featureFlags

        this.loadIfEnabled()
    }

    loadIfEnabled() {
        if (this.instance.config.disable_web_experiments || !this.instance.consent.isOptedOut()) {
            console.log(`is opted out`)
            return
        }

        this.getWebExperimentsAndEvaluateDisplayLogic()
    }

    public getWebExperimentsAndEvaluateDisplayLogic = (forceReload: boolean = false): void => {
        this.getWebExperiments((webExperiments) => {
            webExperiments.forEach((webExperiment) => {
                if (
                    webExperiment.feature_flag_key &&
                    this._featureFlags &&
                    this._featureFlags[webExperiment.feature_flag_key]
                ) {
                    const selectedVariant = this._featureFlags[webExperiment.feature_flag_key] as unknown as string
                    console.log(
                        `selectedVariant is `,
                        selectedVariant,
                        ` webExperiment.variants is `,
                        webExperiment.variants
                    )
                    if (selectedVariant && webExperiment.variants[selectedVariant]) {
                        WebExperiments.applyTransforms(webExperiment.variants[selectedVariant].transforms)
                    }
                } else if (webExperiment.variants) {
                    for (const variant in webExperiment.variants) {
                        const testVariant = webExperiment.variants[variant]
                        const matchTest = WebExperiments.matchesTestVariant(testVariant)
                        console.log(`variant is `, variant, ` matchTest is `, matchTest)
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
        if (isUndefined(testVariant.conditions)) {
            return false
        }
        const match = WebExperiments.matchUrlConditions(testVariant) && WebExperiments.matchUTMConditions(testVariant)
        console.log(
            `variant is `,
            testVariant,
            `  url match is `,
            WebExperiments.matchUrlConditions(testVariant),
            ` utm match is `,
            WebExperiments.matchUTMConditions(testVariant)
        )
        return match
    }

    private static matchUrlConditions(testVariant: WebExperimentVariant): boolean {
        if (isUndefined(testVariant.conditions) || isUndefined(testVariant.conditions?.url)) {
            return true
        }

        console.log(
            ` matching URL of type [`,
            testVariant.conditions?.urlMatchType,
            `] with url [`,
            testVariant.conditions?.url,
            `]`
        )
        // console.log(` window?.location.href is `, window?.location.href)
        const location = WebExperiments.getWindowLocation()
        if (location) {
            const urlCheck = testVariant.conditions?.url
                ? webExperimentUrlValidationMap[testVariant.conditions?.urlMatchType ?? 'icontains'](
                      testVariant.conditions.url,
                      location
                  )
                : true
            console.log(`urlCheck is `, urlCheck, `  manual test is `, location.href == testVariant.conditions?.url)
            return urlCheck
        }

        return false
    }

    public static getWindowLocation(): Location | undefined {
        return window?.location
    }

    private static matchUTMConditions(testVariant: WebExperimentVariant): boolean {
        if (isUndefined(testVariant.conditions) || isUndefined(testVariant.conditions?.utm)) {
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

    private static applyTransforms(transforms: WebExperimentTransform[]) {
        transforms.forEach((transform) => {
            // eslint-disable-next-line no-console
            console.log(`applying transform `, transform)
            if (transform.selector) {
                const elements = _document?.querySelectorAll(transform.selector)
                elements?.forEach((element) => {
                    // eslint-disable-next-line no-console
                    console.log(
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
