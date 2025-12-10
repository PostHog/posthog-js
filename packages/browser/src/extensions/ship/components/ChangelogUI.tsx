import { useState, useEffect } from 'preact/hooks'
import * as Preact from 'preact'
import { PostHog } from '../../../posthog-core'
import { prepareStylesheet } from '../../utils/stylesheet-loader'
import { document as _document } from '../../../utils/globals'
import { KanbanBoard, KanbanColumn } from './KanbanBoard'
import { ExpandableCard } from './ExpandableCard'
import sharedStyles from './shared.css'
import { ChangelogEntry } from '../../../types'
import { formatMonthTitle, generateMonthRange, getMonthKey, parseMonthKey } from '../ship-extension-utils'

const document = _document as Document

export interface ChangelogUIProps {
    posthogInstance: PostHog
}

function ChangelogUI({ posthogInstance }: ChangelogUIProps) {
    const [entries, setEntries] = useState<ChangelogEntry[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        posthogInstance.getChangelogEntries((changelogEntries) => {
            setEntries(changelogEntries)
            setLoading(false)
        })
    }, [posthogInstance])

    // Group entries by month and generate columns (oldest first)
    const monthRange = generateMonthRange(entries)
    const entriesByMonth = new Map<string, ChangelogEntry[]>()

    // Initialize all months with empty arrays
    for (const monthKey of monthRange) {
        entriesByMonth.set(monthKey, [])
    }

    // Populate with entries
    for (const entry of entries) {
        const monthKey = getMonthKey(entry.date)
        const existing = entriesByMonth.get(monthKey) || []
        existing.push(entry)
        entriesByMonth.set(monthKey, existing)
    }

    // Build columns (oldest first, so we reverse at the end for right-align)
    const columns: KanbanColumn<ChangelogEntry>[] = monthRange.map((monthKey) => {
        const { year, month } = parseMonthKey(monthKey)
        return {
            id: monthKey,
            title: formatMonthTitle(year, month),
            description: '',
            items: entriesByMonth.get(monthKey) || [],
        }
    })

    if (loading) {
        return (
            <div className="ship-ui">
                <div className="ship-ui__loading">Loading changelog...</div>
            </div>
        )
    }

    if (entries.length === 0) {
        return (
            <div className="ship-ui">
                <p className="ship-ui__empty">No changelog entries available.</p>
            </div>
        )
    }

    return (
        <div className="ship-ui">
            <KanbanBoard
                columns={columns}
                renderItem={(entry) => <ChangelogCard entry={entry} />}
                getItemKey={(entry) => `${entry.id}`}
                emptyMessage="No updates"
                rightAlign
            />
        </div>
    )
}

interface ChangelogCardProps {
    entry: ChangelogEntry
}

function ChangelogCard({ entry }: ChangelogCardProps): Preact.JSX.Element {
    const formattedDate = new Date(entry.date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
    })

    const productArea = entry.product_item?.product_area?.name
    const role = entry.product_item?.role?.name

    return (
        <ExpandableCard
            className="changelog-card"
            title={<h4 className="expandable-card__title">{entry.name}</h4>}
            description={entry.description}
            meta={
                <div className="changelog-card__meta">
                    <span className="changelog-card__date">{formattedDate}</span>
                    {productArea && <span className="badge badge--product-area">{productArea}</span>}
                    {role && <span className="badge badge--role">{role}</span>}
                </div>
            }
        />
    )
}

function getChangelogStylesheet(posthog?: PostHog): HTMLStyleElement | null {
    const stylesheet = prepareStylesheet(document, typeof sharedStyles === 'string' ? sharedStyles : '', posthog)
    stylesheet?.setAttribute('data-ph-changelog-style', 'true')
    return stylesheet
}

export interface RenderChangelogUIOptions {
    posthogInstance: PostHog
    container: HTMLElement
}

/**
 * Renders the Changelog UI into a container element using Shadow DOM for style isolation.
 * Returns an unmount function to clean up when done.
 */
export const renderChangelogUI = ({ posthogInstance, container: element }: RenderChangelogUIOptions): (() => void) => {
    // Use existing shadow root if present (e.g., after React StrictMode remount),
    // otherwise create a new one
    const shadowRoot = element.shadowRoot ?? element.attachShadow({ mode: 'open' })

    // Only inject stylesheet if not already present
    if (!shadowRoot.querySelector('[data-ph-changelog-style]')) {
        const stylesheet = getChangelogStylesheet(posthogInstance)
        if (stylesheet) {
            shadowRoot.appendChild(stylesheet)
        }
    }

    Preact.render(<ChangelogUI posthogInstance={posthogInstance} />, shadowRoot)

    // Return unmount function
    return () => {
        Preact.render(null, shadowRoot)
    }
}
