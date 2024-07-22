import { PostHog } from './posthog-core'
import { DecideResponse, JsonRecord, JsonType } from './types'
import { document as _document } from './utils/globals'
import { ExperimentVariantTransition } from './posthog-experiments-types'
import { isUndefined } from './utils/type-utils'

export class PosthogExperiments {
    instance: PostHog
    private _featureFlagPayloads?: Record<string, JsonType>

    constructor(instance: PostHog) {
        this.instance = instance
    }

    afterDecideResponse(response: DecideResponse) {
        this._featureFlagPayloads = response.featureFlagPayloads
        this.loadIfEnabled()
    }

    loadIfEnabled() {
        this.applyFeatureFlagPayloads()
    }

    applyFeatureFlagPayloads() {
        if (isUndefined(_document) || isUndefined(this._featureFlagPayloads)) {
            return
        }

        if (this._featureFlagPayloads) {
            for (const key in this._featureFlagPayloads) {
                const variant = this._featureFlagPayloads[key]

                const jsonRecord = variant as JsonRecord
                if (jsonRecord && jsonRecord.hasOwnProperty('data')) {
                    const transitions = jsonRecord['data'] as ExperimentVariantTransition[]
                    if (transitions) {
                        PosthogExperiments.applyTransitions(transitions)
                    }
                }
            }
        }
    }

    private static applyTransitions(transitions: ExperimentVariantTransition[]) {
        transitions.forEach((transition) => {
            // eslint-disable-next-line no-console
            console.log(`applying transition `, transition)
            if (transition.selector) {
                const elements = _document?.querySelectorAll(transition.selector)
                elements?.forEach((element) => {
                    // eslint-disable-next-line no-console
                    console.log(`applying transition to element `, element, ` element.nodeType is `, element.nodeType)

                    if (transition.text) {
                        const htmlElement = element as HTMLElement
                        if (htmlElement) {
                            htmlElement.innerText = transition.text
                        }
                    }
                })
            }
        })
    }

    //
    // _isVariantTransition(obj: any): obj is ExperimentVariantTransition {
    //     return obj && typeof obj.name === 'string'
    // }

    //         function isAnimal(obj: any):
    //     obj is Animal {
    //
    // }
}
