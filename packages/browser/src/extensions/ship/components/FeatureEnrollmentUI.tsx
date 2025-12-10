import { useState, useEffect } from 'preact/hooks'
import * as Preact from 'preact'
import { PostHog } from '../../../posthog-core'
import { createLogger } from '../../../utils/logger'
import { EarlyAccessFeature, EarlyAccessFeatureStage } from '../../../types'
import { prepareStylesheet } from '../../utils/stylesheet-loader'
import { document as _document } from '../../../utils/globals'
import featureEnrollmentStyles from './FeatureEnrollmentUI.css'
import { KanbanBoard, KanbanColumn } from './KanbanBoard'
import { FEATURE_STAGE_CONFIGS, ALL_STAGES } from '../ship-extension-utils'
import { ExpandableCard } from './ExpandableCard'

const document = _document as Document
const logger = createLogger('[PostHog FeatureEnrollmentUI]')

export interface FeatureEnrollmentUIProps {
    posthogInstance: PostHog
    stages: EarlyAccessFeatureStage[]
}

interface EarlyAccessFeatureWithOptInState extends EarlyAccessFeature {
    enabled: boolean
}

export interface FeatureStageConfig {
    stage: EarlyAccessFeatureStage
    title: string
    description: string
}

function FeatureEnrollmentUI({ posthogInstance, stages }: FeatureEnrollmentUIProps) {
    const [features, setFeatures] = useState<EarlyAccessFeatureWithOptInState[]>([])
    const [loading, setLoading] = useState(true)

    const fetchFeatures = (forceReload: boolean = false) => {
        posthogInstance.getEarlyAccessFeatures(
            (earlyAccessFeatures) => {
                logger.info('Fetched early access features', earlyAccessFeatures)
                const enriched = earlyAccessFeatures.map((feature) => ({
                    ...feature,
                    enabled: feature.flagKey ? (posthogInstance.isFeatureEnabled(feature.flagKey) ?? false) : false,
                }))
                setFeatures(enriched)
                setLoading(false)
            },
            forceReload,
            stages
        )
    }

    useEffect(() => {
        // Initial fetch
        fetchFeatures(true)

        // Listen for feature flag changes and re-evaluate enrollment status
        const unsubscribe = posthogInstance.onFeatureFlags(() => {
            // Re-evaluate enabled status based on updated flags (don't force reload from server)
            setFeatures((prev) =>
                prev.map((feature) => ({
                    ...feature,
                    enabled: feature.flagKey ? (posthogInstance.isFeatureEnabled(feature.flagKey) ?? false) : false,
                }))
            )
        })

        return () => {
            unsubscribe?.()
        }
    }, [posthogInstance, stages])

    const handleToggle = (feature: EarlyAccessFeatureWithOptInState, newValue: boolean) => {
        if (!feature.flagKey) {
            return
        }
        posthogInstance.updateEarlyAccessFeatureEnrollment(feature.flagKey, newValue, feature.stage)
        setFeatures((prev) =>
            prev.map((f) => {
                if (f.flagKey === feature.flagKey) {
                    // For upvote (concept/alpha), increment count when enabling
                    const newCount =
                        newValue && (f.stage === 'concept' || f.stage === 'alpha')
                            ? (f.optedInCount ?? 0) + 1
                            : f.optedInCount
                    return { ...f, enabled: newValue, optedInCount: newCount }
                }
                return f
            })
        )
    }

    const getFeaturesByStage = (stage: EarlyAccessFeatureStage) => features.filter((f) => f.stage === stage)

    const columns: KanbanColumn<EarlyAccessFeatureWithOptInState>[] = FEATURE_STAGE_CONFIGS.filter((config) =>
        stages.includes(config.stage)
    ).map((config) => ({
        id: config.stage,
        title: config.title,
        description: config.description,
        items: getFeaturesByStage(config.stage),
    }))

    if (loading) {
        return (
            <div className="feature-enrollment-ui">
                <div className="feature-enrollment-ui__loading">Loading features...</div>
            </div>
        )
    }

    if (features.length === 0) {
        return (
            <div className="feature-enrollment-ui">
                <p className="feature-enrollment-ui__empty">No early access features available.</p>
            </div>
        )
    }

    return (
        <div className="feature-enrollment-ui">
            <KanbanBoard
                columns={columns}
                renderItem={(feature) => <FeatureCard feature={feature} onToggle={handleToggle} />}
                getItemKey={(feature) => feature.flagKey ?? feature.name}
                emptyMessage="No features"
            />
        </div>
    )
}

interface FeatureCardProps {
    feature: EarlyAccessFeatureWithOptInState
    onToggle: (feature: EarlyAccessFeatureWithOptInState, newValue: boolean) => void
}

function FeatureCard({ feature, onToggle }: FeatureCardProps): Preact.JSX.Element {
    const isConcept = feature.stage === 'concept'
    const isAlpha = feature.stage === 'alpha'
    const isBeta = feature.stage === 'beta'

    const showUpvote = isConcept || isAlpha
    const showEnrolledToggle = isBeta

    const optedInCount = feature.optedInCount ?? 0

    // Upvote button for concept/alpha - one-way action (can't un-upvote)
    const upvoteElement = showUpvote ? (
        <button
            type="button"
            className={`feature-card__upvote ${feature.enabled ? 'feature-card__upvote--active' : ''}`}
            onClick={() => !feature.enabled && onToggle(feature, true)}
            disabled={feature.enabled}
            aria-label={feature.enabled ? 'Upvoted' : 'Upvote this feature'}
            title={feature.enabled ? 'Upvoted' : 'Upvote'}
        >
            <span className="feature-card__upvote-arrow">▲</span>
            <span className="feature-card__upvote-count">{optedInCount}</span>
        </button>
    ) : null

    // Toggle for beta features
    const toggleElement = showEnrolledToggle ? (
        <label className="feature-card__toggle-label">
            <input
                type="checkbox"
                className="feature-card__toggle"
                checked={feature.enabled}
                onChange={(e) => onToggle(feature, (e.target as HTMLInputElement).checked)}
            />
            <span className="feature-card__toggle-switch" />
        </label>
    ) : null

    return (
        <ExpandableCard
            id={feature.flagKey ?? undefined}
            className={`feature-card feature-card--${feature.stage}`}
            title={
                <>
                    {upvoteElement}
                    {toggleElement}
                    <h4 className="expandable-card__title">{feature.name}</h4>
                </>
            }
            description={feature.description}
            footer={
                feature.documentationUrl ? (
                    <a href={feature.documentationUrl} target="_blank" rel="noopener noreferrer" className="link">
                        Learn more{' >'}
                    </a>
                ) : undefined
            }
        />
    )
}

function getFeatureEnrollmentStylesheet(posthog?: PostHog): HTMLStyleElement | null {
    const stylesheet = prepareStylesheet(
        document,
        typeof featureEnrollmentStyles === 'string' ? featureEnrollmentStyles : '',
        posthog
    )
    stylesheet?.setAttribute('data-ph-feature-enrollment-style', 'true')
    return stylesheet
}

export interface RenderFeatureEnrollmentUIOptions {
    posthogInstance: PostHog
    container: HTMLElement
    stages?: EarlyAccessFeatureStage[]
}

/**
 * Renders the Feature Enrollment UI into a container element using Shadow DOM for style isolation.
 * Returns an unmount function to clean up when done.
 */
export const renderFeatureEnrollmentUI = ({
    posthogInstance,
    container: element,
    stages = ALL_STAGES,
}: RenderFeatureEnrollmentUIOptions): (() => void) => {
    // Use existing shadow root if present (e.g., after React StrictMode remount),
    // otherwise create a new one
    const shadowRoot = element.shadowRoot ?? element.attachShadow({ mode: 'open' })

    // Only inject stylesheet if not already present
    if (!shadowRoot.querySelector('[data-ph-feature-enrollment-style]')) {
        const stylesheet = getFeatureEnrollmentStylesheet(posthogInstance)
        if (stylesheet) {
            shadowRoot.appendChild(stylesheet)
        }
    }

    Preact.render(<FeatureEnrollmentUI posthogInstance={posthogInstance} stages={stages} />, shadowRoot)

    // Return unmount function
    return () => {
        Preact.render(null, shadowRoot)
    }
}
