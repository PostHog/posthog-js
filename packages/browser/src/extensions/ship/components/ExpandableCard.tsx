import { useState, useEffect, useRef } from 'preact/hooks'
import * as Preact from 'preact'

export interface ExpandableCardProps {
    id?: string
    className?: string
    title: Preact.ComponentChildren
    description?: string | null
    footer?: Preact.ComponentChildren
    meta?: Preact.ComponentChildren
}

/**
 * A reusable card component with an expandable description.
 * Used by both FeatureCard and ChangelogCard.
 */
export function ExpandableCard({
    id,
    className,
    title,
    description,
    footer,
    meta,
}: ExpandableCardProps): Preact.JSX.Element {
    const [isExpanded, setIsExpanded] = useState(false)
    const [isTruncated, setIsTruncated] = useState(false)
    const descriptionRef = useRef<HTMLParagraphElement>(null)

    useEffect(() => {
        const el = descriptionRef.current
        if (el) {
            // Check if content is truncated by comparing scrollHeight to clientHeight
            setIsTruncated(el.scrollHeight > el.clientHeight)
        }
    }, [description])

    const descriptionContent = (
        <div className="expandable-card__description-wrapper">
            <p
                ref={descriptionRef}
                className={`expandable-card__description ${isExpanded ? 'expandable-card__description--expanded' : ''}`}
            >
                {description || <span className="expandable-card__no-description">No description</span>}
            </p>
            {isTruncated && (
                <button
                    type="button"
                    className="expandable-card__expand-btn"
                    onClick={() => setIsExpanded(!isExpanded)}
                    aria-expanded={isExpanded}
                >
                    {isExpanded ? '−' : '+'}
                </button>
            )}
        </div>
    )

    return (
        <div className={`expandable-card ${className ?? ''}`} id={id}>
            <div className="expandable-card__header">{title}</div>
            {descriptionContent}
            {meta && <div className="expandable-card__meta">{meta}</div>}
            {footer && <div className="expandable-card__footer">{footer}</div>}
        </div>
    )
}
