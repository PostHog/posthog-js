import createDOMPurify from 'dompurify'
import { PostHog } from './posthog-core'
import { navigator, window } from '@posthog/browser-common/utils/globals'
import {
    WebExperiment,
    WebExperimentsCallback,
    WebExperimentTransform,
    WebExperimentUrlMatchType,
    WebExperimentVariant,
} from './web-experiments-types'
import { WEB_EXPERIMENTS } from './constants'
import { isNullish, isString } from '@posthog/core'
import { getQueryParam } from '@posthog/browser-common/utils/request-utils'
import { isMatchingRegex } from '@posthog/browser-common/utils/regex-utils'
import { applyUrlTargetingOverride } from '@posthog/browser-common/utils/url-targeting-utils'
import { logger } from '@posthog/browser-common/utils/logger'
import { isLikelyBot } from '@posthog/browser-common/utils/blocked-uas'
import { getCampaignParams } from '@posthog/browser-common/utils/event-utils'
import { Extension } from './extensions/types'

const BOT_REFUSE_MSG = 'Refusing to render web experiment since the viewer is a likely bot'
const EXPERIMENT_HTML_CONFIG = {
    ADD_ATTR: (attribute: string, tag: string) =>
        (attribute === 'target' && tag === 'a') ||
        (attribute === 'form' && /^(button|fieldset|input|output|select|textarea)$/.test(tag)),
    // Form associations are literal element IDs, not URLs.
    ADD_URI_SAFE_ATTR: ['form'],
}
let experimentSanitizer: ReturnType<typeof createDOMPurify> | undefined

export const webExperimentUrlValidationMap: Record<
    WebExperimentUrlMatchType,
    (conditionsUrl: string, href: string) => boolean
> = {
    icontains: (conditionsUrl, href) => href.toLowerCase().indexOf(conditionsUrl.toLowerCase()) > -1,
    not_icontains: (conditionsUrl, href) => href.toLowerCase().indexOf(conditionsUrl.toLowerCase()) === -1,
    regex: (conditionsUrl, href) => isMatchingRegex(href, conditionsUrl),
    not_regex: (conditionsUrl, href) => !isMatchingRegex(href, conditionsUrl),
    exact: (conditionsUrl, href) => href === conditionsUrl,
    is_not: (conditionsUrl, href) => href !== conditionsUrl,
}

export class WebExperiments implements Extension {
    private _flagToExperiments?: Map<string, WebExperiment>

    private get _config() {
        return this._instance.config
    }

    constructor(private _instance: PostHog) {
        this._instance.onFeatureFlags((flags: string[]) => {
            this.onFeatureFlags(flags)
        })
    }

    // No-op: activation is driven by the onFeatureFlags callback registered in the constructor
    initialize() {}

    onFeatureFlags(flags: string[]) {
        if (this._is_bot()) {
            WebExperiments._logInfo(BOT_REFUSE_MSG)
            return
        }

        if (this._config.disable_web_experiments) {
            return
        }

        if (isNullish(this._flagToExperiments)) {
            // Indicates first load so we trigger the loaders
            this._flagToExperiments = new Map<string, WebExperiment>()
            this.loadIfEnabled()
            this.previewWebExperiment()
            return
        }

        WebExperiments._logInfo('applying feature flags', flags)
        flags.forEach((flag) => {
            if (this._flagToExperiments && this._flagToExperiments?.has(flag)) {
                const selectedVariant = this._instance.getFeatureFlag(flag) as unknown as string
                const webExperiment = this._flagToExperiments?.get(flag)
                if (selectedVariant && webExperiment?.variants[selectedVariant]) {
                    this._applyVariantForFlag(webExperiment, selectedVariant)
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
                WebExperiments._logInfo(`previewing web experiments ${experimentID} && ${variant}`)
                this.getWebExperiments(
                    (webExperiments) => {
                        this._showPreviewWebExperiment(parseInt(experimentID), variant, webExperiments)
                    },
                    false,
                    true
                )
            }
        }
    }

    loadIfEnabled() {
        if (this._config.disable_web_experiments) {
            return
        }

        this.getWebExperimentsAndEvaluateDisplayLogic()
    }

    public getWebExperimentsAndEvaluateDisplayLogic = (forceReload: boolean = false): void => {
        this.getWebExperiments((webExperiments) => {
            WebExperiments._logInfo(`retrieved web experiments from the server`)
            this._flagToExperiments = new Map<string, WebExperiment>()

            webExperiments.forEach((webExperiment) => {
                if (webExperiment.feature_flag_key) {
                    if (this._flagToExperiments) {
                        WebExperiments._logInfo(
                            `setting flag key `,
                            webExperiment.feature_flag_key,
                            ` to web experiment `,
                            webExperiment
                        )
                        this._flagToExperiments?.set(webExperiment.feature_flag_key, webExperiment)
                    }

                    const selectedVariant = this._instance.getFeatureFlag(webExperiment.feature_flag_key)
                    if (isString(selectedVariant) && webExperiment.variants[selectedVariant]) {
                        this._applyVariantForFlag(webExperiment, selectedVariant)
                    }
                } else if (webExperiment.variants) {
                    for (const variant in webExperiment.variants) {
                        const testVariant = webExperiment.variants[variant]
                        const matchTest = WebExperiments._matchesTestVariant(testVariant, this._instance)
                        if (matchTest) {
                            this._applyTransforms(webExperiment.name, variant, testVariant.transforms)
                        }
                    }
                }
            })
        }, forceReload)
    }

    public getWebExperiments(callback: WebExperimentsCallback, forceReload: boolean, previewing?: boolean) {
        if (this._config.disable_web_experiments && !previewing) {
            return callback([])
        }

        const existingWebExperiments = this._instance.get_property(WEB_EXPERIMENTS)
        if (existingWebExperiments && !forceReload) {
            return callback(existingWebExperiments)
        }

        this._instance._send_request({
            url: this._instance.requestRouter.endpointFor('api', `/api/web_experiments/?token=${this._config.token}`),
            method: 'GET',
            timestampMode: 'query',
            callback: (response) => {
                if (response.statusCode !== 200 || !response.json) {
                    return callback([])
                }
                const webExperiments = response.json.experiments || []
                return callback(webExperiments)
            },
        })
    }

    private _showPreviewWebExperiment(experimentID: number, variant: string, webExperiments: WebExperiment[]) {
        const previewExperiments = webExperiments.filter((exp) => exp.id === experimentID)
        if (previewExperiments && previewExperiments.length > 0) {
            WebExperiments._logInfo(
                `Previewing web experiment [${previewExperiments[0].name}] with variant [${variant}]`
            )
            this._applyTransforms(
                previewExperiments[0].name,
                variant,
                previewExperiments[0].variants[variant].transforms
            )
        }
    }
    // A variant carries its own URL conditions whether or not the experiment runs on a feature flag, so the
    // flag only decides who sees the variant, never which pages it changes.
    private _applyVariantForFlag(webExperiment: WebExperiment, variant: string) {
        const testVariant = webExperiment.variants[variant]
        if (!WebExperiments._matchUrlConditions(testVariant, this._instance)) {
            WebExperiments._logInfo(
                `skipping variant ${variant} of experiment ${webExperiment.name} because this page does not match its url conditions`
            )
            return
        }
        this._applyTransforms(webExperiment.name, variant, testVariant.transforms)
    }

    private static _matchesTestVariant(testVariant: WebExperimentVariant, instance: PostHog) {
        if (isNullish(testVariant.conditions)) {
            return false
        }
        return (
            WebExperiments._matchUrlConditions(testVariant, instance) && WebExperiments._matchUTMConditions(testVariant)
        )
    }

    private static _matchUrlConditions(testVariant: WebExperimentVariant, instance: PostHog): boolean {
        if (isNullish(testVariant.conditions) || isNullish(testVariant.conditions?.url)) {
            return true
        }

        const location = WebExperiments.getWindowLocation()
        if (location) {
            // honors the `get_current_url` config hook so apps that rewrite their URL can target experiments correctly
            const href = applyUrlTargetingOverride(instance, location.href)
            const urlCheck = testVariant.conditions?.url
                ? webExperimentUrlValidationMap[testVariant.conditions?.urlMatchType ?? 'icontains'](
                      testVariant.conditions.url,
                      href
                  )
                : true
            return urlCheck
        }

        return false
    }

    public static getWindowLocation(): Location | undefined {
        return window?.location
    }

    private static _matchUTMConditions(testVariant: WebExperimentVariant): boolean {
        if (isNullish(testVariant.conditions) || isNullish(testVariant.conditions?.utm)) {
            return true
        }
        const campaignParams = getCampaignParams()
        if (campaignParams['utm_source']) {
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

    private static _logInfo(msg: string, ...args: any[]) {
        logger.info(`[WebExperiments] ${msg}`, args)
    }

    private static _logWarn(msg: string, ...args: any[]) {
        logger.warn(`[WebExperiments] ${msg}`, args)
    }

    private static _sanitizeLinkTargets(context: Element) {
        const root =
            context.namespaceURI === 'http://www.w3.org/1999/xhtml' && context.localName === 'template'
                ? (context as HTMLTemplateElement).content
                : context
        root.querySelectorAll('a[target], template').forEach((element) => {
            if (element.localName === 'template') {
                if (element.namespaceURI === 'http://www.w3.org/1999/xhtml') {
                    WebExperiments._sanitizeLinkTargets(element)
                }
                return
            }
            if (
                element.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
                element.getAttribute('target')?.toLowerCase() !== '_blank'
            ) {
                element.removeAttribute('target')
                return
            }
            const rel = (element.getAttribute('rel') || '')
                .split(/\s+/)
                .filter((token) => token && !/^(opener|noopener)$/i.test(token))
            rel.push('noopener')
            element.setAttribute('rel', rel.join(' '))
        })
    }

    private _applyTransforms(experiment: string, variant: string, transforms: WebExperimentTransform[]) {
        if (this._is_bot()) {
            WebExperiments._logInfo(BOT_REFUSE_MSG)
            return
        }

        if (variant === 'control') {
            WebExperiments._logInfo('Control variants leave the page unmodified.')
            return
        }

        transforms.forEach((transform) => {
            if (transform.selector) {
                WebExperiments._logInfo(
                    `applying transform of variant ${variant} for experiment ${experiment} `,
                    transform
                )

                // oxlint-disable-next-line no-restricted-globals
                const elements = document?.querySelectorAll(transform.selector)
                if (!elements?.length) {
                    // The flag still counts the exposure, so without this the variant reads as a null result.
                    WebExperiments._logWarn(
                        `no element on this page matches selector ${transform.selector} of variant ${variant} for experiment ${experiment}`
                    )
                    return
                }
                const sanitizedHtml = new Map<string, string>()
                elements?.forEach((element) => {
                    // Sanitized plain text can still execute inside existing HTML or SVG script elements.
                    if (element.localName.toLowerCase() === 'script') {
                        return
                    }

                    const htmlElement = element as HTMLElement
                    if (transform.html) {
                        const encoding =
                            element.namespaceURI === 'http://www.w3.org/1998/Math/MathML' &&
                            element.localName === 'annotation-xml'
                                ? element.getAttribute('encoding')?.toLowerCase() || ''
                                : ''
                        const contextKey = JSON.stringify([element.namespaceURI, element.localName, encoding])
                        let html = sanitizedHtml.get(contextKey)
                        if (isNullish(html)) {
                            const sanitizer = (experimentSanitizer ??= createDOMPurify())
                            // Parse in an inert document so unsanitized content cannot execute or upgrade custom elements.
                            const inertDocument = element.ownerDocument.implementation.createHTMLDocument('')
                            const context = inertDocument.createElementNS(element.namespaceURI, element.localName)
                            if (encoding) {
                                context.setAttribute('encoding', encoding)
                            }
                            const range = inertDocument.createRange()
                            range.selectNodeContents(context)
                            const namespace =
                                (element.namespaceURI === 'http://www.w3.org/2000/svg' &&
                                    /^(foreignObject|desc|title)$/.test(element.localName)) ||
                                /^(text\/html|application\/xhtml\+xml)$/.test(encoding)
                                    ? 'http://www.w3.org/1999/xhtml'
                                    : element.namespaceURI
                            const fragment = range.createContextualFragment(transform.html)
                            if (
                                element.namespaceURI === 'http://www.w3.org/1998/Math/MathML' &&
                                /^(mi|mo|mn|ms|mtext)$/.test(element.localName)
                            ) {
                                // Keep the integration-point parent so both HTML and MathML children retain their namespaces.
                                context.appendChild(fragment)
                                sanitizer.sanitize(context, {
                                    ...EXPERIMENT_HTML_CONFIG,
                                    NAMESPACE: namespace || undefined,
                                    IN_PLACE: true,
                                })
                            } else {
                                const container =
                                    context.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
                                    context.localName === 'template'
                                        ? (context as HTMLTemplateElement).content
                                        : context
                                container.appendChild(
                                    sanitizer.sanitize(fragment, {
                                        ...EXPERIMENT_HTML_CONFIG,
                                        NAMESPACE: namespace || undefined,
                                        RETURN_DOM_FRAGMENT: true,
                                    })
                                )
                            }
                            WebExperiments._sanitizeLinkTargets(context)
                            html = context.innerHTML
                            sanitizedHtml.set(contextKey, html)
                        }
                        htmlElement.innerHTML = html
                    }

                    if (transform.css) {
                        htmlElement.setAttribute('style', transform.css)
                    }
                })
            }
        })
    }

    _is_bot(): boolean | undefined {
        if (navigator && this._instance) {
            return isLikelyBot(navigator, this._config.custom_blocked_useragents)
        } else {
            return undefined
        }
    }
}
