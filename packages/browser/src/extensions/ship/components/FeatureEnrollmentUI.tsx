import { useState, useEffect, useRef } from 'preact/hooks'
import * as Preact from 'preact'
import { PostHog } from '../../../posthog-core'
import { createLogger } from '../../../utils/logger'
import { EarlyAccessFeature, EarlyAccessFeatureStage } from '../../../types'
import { prepareStylesheet } from '../../utils/stylesheet-loader'
import { document as _document } from '../../../utils/globals'
import featureEnrollmentStyles from './FeatureEnrollmentUI.css'
import { isNull } from '@posthog/core'
import { KanbanBoard, KanbanColumn } from './KanbanBoard'

const document = _document as Document
const logger = createLogger('[PostHog FeatureEnrollmentUI]')

export interface FeatureEnrollmentUIProps {
    posthogInstance: PostHog
    stages: EarlyAccessFeatureStage[]
}

interface EarlyAccessFeatureWithOptInState extends EarlyAccessFeature {
    enabled: boolean
}

interface FeatureStageConfig {
    stage: EarlyAccessFeatureStage
    title: string
    description: string
}

const FEATURE_STAGE_CONFIGS: FeatureStageConfig[] = [
    { stage: 'concept', title: 'Ideas', description: 'Features we are considering' },
    { stage: 'alpha', title: 'In progress', description: 'Currently being built' },
    { stage: 'beta', title: 'Early access', description: 'Available to try now' },
    { stage: 'general-availability', title: 'Released', description: 'Generally available' },
]

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
        setFeatures((prev) => prev.map((f) => (f.flagKey === feature.flagKey ? { ...f, enabled: newValue } : f)))
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

    // Only beta features get a toggle, concept and alpha get "notify me" button
    const showToggle = isBeta
    const showNotifyButton = isConcept || isAlpha

    const [isExpanded, setIsExpanded] = useState(false)
    const [isTruncated, setIsTruncated] = useState(false)
    const descriptionRef = useRef<HTMLParagraphElement>(null)

    useEffect(() => {
        const el = descriptionRef.current
        if (el) {
            // Check if content is truncated by comparing scrollHeight to clientHeight
            setIsTruncated(el.scrollHeight > el.clientHeight)
        }
    }, [feature.description])

    return (
        <div className={`feature-card feature-card--${feature.stage}`} id={feature.flagKey ?? undefined}>
            <div className="feature-card__header">
                {showToggle ? (
                    <label className="feature-card__toggle-label">
                        <input
                            type="checkbox"
                            className="feature-card__toggle"
                            checked={feature.enabled}
                            onChange={(e) => onToggle(feature, (e.target as HTMLInputElement).checked)}
                        />
                        <span className="feature-card__toggle-switch" />
                        <h4 className="feature-card__name">{feature.name}</h4>
                    </label>
                ) : (
                    <h4 className="feature-card__name">{feature.name}</h4>
                )}
            </div>
            <div className="feature-card__description-wrapper">
                <p
                    ref={descriptionRef}
                    className={`feature-card__description ${isExpanded ? 'feature-card__description--expanded' : ''}`}
                >
                    {feature.description || <span className="feature-card__no-description">No description</span>}
                </p>
                {isTruncated && (
                    <button
                        type="button"
                        className="feature-card__expand-btn"
                        onClick={() => setIsExpanded(!isExpanded)}
                        aria-expanded={isExpanded}
                    >
                        {isExpanded ? '−' : '+'}
                    </button>
                )}
            </div>
            {!isNull(feature.optedInCount) && feature.optedInCount > 0 && (
                <div className="feature-card__interested-count">
                    {feature.optedInCount} {feature.optedInCount === 1 ? 'user' : 'users'} opted in
                </div>
            )}
            <div className="feature-card__footer">
                {showNotifyButton && (
                    <button
                        type="button"
                        className={`feature-card__button ${feature.enabled ? 'feature-card__button--registered' : ''}`}
                        disabled={feature.enabled}
                        onClick={() => onToggle(feature, true)}
                    >
                        {feature.enabled ? '✓ Subscribed' : 'Subscribe'}
                    </button>
                )}
                {feature.documentationUrl && (
                    <a
                        href={feature.documentationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="feature-card__link"
                    >
                        Learn more
                    </a>
                )}
            </div>
        </div>
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

const ALL_STAGES: EarlyAccessFeatureStage[] = ['concept', 'alpha', 'beta', 'general-availability']

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
