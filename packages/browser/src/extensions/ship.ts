import { PostHog } from '../posthog-core'
import { EarlyAccessFeatureStage } from '../types'
import { renderFeatureEnrollmentUI, RenderFeatureEnrollmentUIOptions } from './ship/components/FeatureEnrollmentUI'

// Re-export for external use (e.g., React wrapper)
export { renderFeatureEnrollmentUI }
export type { RenderFeatureEnrollmentUIOptions }

export class Ship {
    constructor(private _instance: PostHog) {}

    renderFeatureEnrollments(container: HTMLElement, stages?: EarlyAccessFeatureStage[]): () => void {
        return renderFeatureEnrollmentUI({
            posthogInstance: this._instance,
            container: container,
            stages: stages,
        })
    }
}

// Extension generator function for the extension system
export function generateShip(posthog: PostHog): Ship {
    return new Ship(posthog)
}
