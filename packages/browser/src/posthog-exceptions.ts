import { ERROR_TRACKING_SUPPRESSION_RULES } from './constants'
import { PostHog } from './posthog-core'
import { ErrorTrackingSuppressionRule, Properties, RemoteConfig } from './types'
import { createLogger } from './utils/logger'
import { propertyComparisons } from './utils/property-utils'
import { isArray, isString } from './utils/type-utils'

const logger = createLogger('[Error tracking]')

export class PostHogExceptions {
    private readonly _instance: PostHog
    private _suppressionRules: ErrorTrackingSuppressionRule[] = []

    constructor(instance: PostHog) {
        this._instance = instance
        this._suppressionRules = this._instance.persistence?.get_property(ERROR_TRACKING_SUPPRESSION_RULES) ?? []
    }

    onRemoteConfig(response: RemoteConfig) {
        const suppressionRules = response.errorTracking?.suppressionRules ?? []

        // store this in-memory in case persistence is disabled
        this._suppressionRules = suppressionRules

        if (this._instance.persistence) {
            this._instance.persistence.register({
                [ERROR_TRACKING_SUPPRESSION_RULES]: this._suppressionRules,
            })
        }
    }

    sendExceptionEvent(properties: Properties) {
        if (this._matchesSuppressionRule(properties)) {
            logger.info('Skipping exception capture because a suppression rule matched')
            return
        }

        this._instance.capture('$exception', properties, {
            _noTruncate: true,
            _batchKey: 'exceptionEvent',
        })
    }

    private _matchesSuppressionRule(properties: Properties): boolean {
        const exceptionList = properties.$exception_list

        if (!exceptionList || !isArray(exceptionList) || exceptionList.length === 0) {
            return false
        }

        const exceptionValues = exceptionList.reduce(
            (acc, { type, value }) => {
                if (isString(type) && type.length > 0) {
                    acc['$exception_types'].push(type)
                }
                if (isString(value) && value.length > 0) {
                    acc['$exception_values'].push(value)
                }
                return acc
            },
            {
                $exception_types: [],
                $exception_values: [],
            }
        )

        return this._suppressionRules.some((rule) => {
            const results = rule.values.map((v) => {
                const compare = propertyComparisons[v.operator]
                const targets = isArray(v.value) ? v.value : [v.value]
                const values = exceptionValues[v.key] ?? []
                return targets.length > 0 ? compare(targets, values) : false
            })
            return rule.type === 'OR' ? results.some(Boolean) : results.every(Boolean)
        })
    }
}
