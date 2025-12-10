import { PostHog } from '../posthog-core'
import { ChangelogCallback, ChangelogEntry, ChangelogResponse, EarlyAccessFeatureStage } from '../types'
import { renderFeatureEnrollmentUI, RenderFeatureEnrollmentUIOptions } from './ship/components/FeatureEnrollmentUI'
import { renderChangelogUI, RenderChangelogUIOptions } from './ship/components/ChangelogUI'

export { renderFeatureEnrollmentUI, renderChangelogUI }
export type { RenderFeatureEnrollmentUIOptions, RenderChangelogUIOptions, ChangelogEntry, ChangelogCallback }

export class Ship {
    constructor(private _instance: PostHog) {}

    renderFeatureEnrollments(container: HTMLElement, stages?: EarlyAccessFeatureStage[]): () => void {
        return renderFeatureEnrollmentUI({
            posthogInstance: this._instance,
            container: container,
            stages: stages,
        })
    }

    renderChangelog(container: HTMLElement): () => void {
        return renderChangelogUI({
            posthogInstance: this._instance,
            container: container,
        })
    }

    getChangelogEntries(callback: ChangelogCallback): void {
        this._instance._send_request({
            url: this._instance.requestRouter.endpointFor(
                'api',
                `/api/changelog_entries/?token=${this._instance.config.token}&include_filter_options=true`
            ),
            method: 'GET',
            callback: (response) => {
                if (!response.json) {
                    callback({} as ChangelogResponse)
                    return
                }
                const changelog = response.json as ChangelogResponse
                callback(changelog)
            },
        })
    }
}

// Extension generator function for the extension system
export function generateShip(posthog: PostHog): Ship {
    return new Ship(posthog)
}
