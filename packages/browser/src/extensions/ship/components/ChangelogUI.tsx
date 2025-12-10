import { addEventListener } from '../../../utils'
import { useState, useEffect, useRef } from 'preact/hooks'
import * as Preact from 'preact'
import { PostHog } from '../../../posthog-core'
import { prepareStylesheet } from '../../utils/stylesheet-loader'
import { document as _document } from '../../../utils/globals'
import { KanbanBoard, KanbanColumn } from './KanbanBoard'
import { ExpandableCard } from './ExpandableCard'
import sharedStyles from './shared.css'
import { ChangelogEntry, ChangelogResponse } from '../../../types'
import {
    DATE_RANGE_OPTIONS,
    DateRangeOption,
    formatMonthTitle,
    generateMonthRange,
    getDateRangeFilter,
    getMonthKey,
    parseMonthKey,
} from '../ship-extension-utils'

const document = _document as Document

export interface ChangelogUIProps {
    posthogInstance: PostHog
}

interface SelectOption {
    id: string
    name: string
}

interface MultiSelectDropdownProps {
    options: SelectOption[]
    selectedIds: Set<string>
    onChange: (selectedIds: Set<string>) => void
    placeholder?: string
    emptyMessage?: string
}

interface DateRangeDropdownProps {
    value: DateRangeOption
    onChange: (value: DateRangeOption) => void
}

function DateRangeDropdown({ value, onChange }: DateRangeDropdownProps) {
    const [isOpen, setIsOpen] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        function handleClickOutside(event: Event) {
            if (!dropdownRef.current) return

            const path = event.composedPath()
            if (!path.includes(dropdownRef.current)) {
                setIsOpen(false)
            }
        }
        addEventListener(document, 'mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const currentLabel = DATE_RANGE_OPTIONS.find((o) => o.value === value)?.label || 'All time'

    return (
        <div className="date-range-select" ref={dropdownRef}>
            <button className="date-range-select__trigger" onClick={() => setIsOpen(!isOpen)} type="button">
                <span className="date-range-select__label">{currentLabel}</span>
                <span className={`date-range-select__chevron ${isOpen ? 'date-range-select__chevron--open' : ''}`}>
                    ▼
                </span>
            </button>
            {isOpen && (
                <div className="date-range-select__dropdown">
                    {DATE_RANGE_OPTIONS.map((option) => (
                        <button
                            key={option.value}
                            className={`date-range-select__option ${value === option.value ? 'date-range-select__option--selected' : ''}`}
                            onClick={() => {
                                onChange(option.value)
                                setIsOpen(false)
                            }}
                            type="button"
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

function MultiSelectDropdown({
    options,
    selectedIds,
    onChange,
    placeholder = 'Select...',
    emptyMessage = 'No options available',
}: MultiSelectDropdownProps) {
    const [isOpen, setIsOpen] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        function handleClickOutside(event: Event) {
            if (!dropdownRef.current) return

            const path = event.composedPath()
            if (!path.includes(dropdownRef.current)) {
                setIsOpen(false)
            }
        }
        addEventListener(document, 'mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const handleToggleOption = (id: string) => {
        const newSelected = new Set(selectedIds)
        if (newSelected.has(id)) {
            newSelected.delete(id)
        } else {
            newSelected.add(id)
        }
        onChange(newSelected)
    }

    const handleClearAll = (e: Event) => {
        e.stopPropagation()
        onChange(new Set())
    }

    const selectedCount = selectedIds.size
    const buttonLabel =
        selectedCount === 0
            ? placeholder
            : selectedCount === 1
              ? options.find((o) => selectedIds.has(o.id))?.name || '1 selected'
              : `${selectedCount} selected`

    return (
        <div className="multi-select" ref={dropdownRef}>
            <button className="multi-select__trigger" onClick={() => setIsOpen(!isOpen)} type="button">
                <span className="multi-select__label">{buttonLabel}</span>
                {selectedCount > 0 && (
                    <button
                        className="multi-select__clear"
                        onClick={handleClearAll}
                        type="button"
                        aria-label="Clear all"
                    >
                        ×
                    </button>
                )}
                <span className={`multi-select__chevron ${isOpen ? 'multi-select__chevron--open' : ''}`}>▼</span>
            </button>
            {isOpen && (
                <div className="multi-select__dropdown">
                    {options.map((option) => (
                        <label key={option.id} className="multi-select__option">
                            <input
                                type="checkbox"
                                checked={selectedIds.has(option.id)}
                                onChange={() => handleToggleOption(option.id)}
                                className="multi-select__checkbox"
                            />
                            <span className="multi-select__option-label">{option.name}</span>
                        </label>
                    ))}
                    {options.length === 0 && <div className="multi-select__empty">{emptyMessage}</div>}
                </div>
            )}
        </div>
    )
}

function ChangelogUI({ posthogInstance }: ChangelogUIProps) {
    const [changelog, setChangelog] = useState<ChangelogResponse>({} as ChangelogResponse)
    const [loading, setLoading] = useState(true)
    const [selectedProductAreas, setSelectedProductAreas] = useState<Set<string>>(new Set())
    const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set())
    const [dateRange, setDateRange] = useState<DateRangeOption>('all_time')

    useEffect(() => {
        posthogInstance.getChangelogEntries((changelog) => {
            setChangelog(changelog)
            setLoading(false)
        })
    }, [posthogInstance])

    // Filter entries by selected product areas, teams, and date range
    const { from: dateFrom, to: dateTo } = getDateRangeFilter(dateRange)
    const filteredEntries = (changelog.changelog_entries || []).filter((entry) => {
        // Filter by product area
        if (selectedProductAreas.size > 0) {
            const productAreaId = entry.product_item?.product_area?.id
            if (!productAreaId || !selectedProductAreas.has(productAreaId)) {
                return false
            }
        }

        // Filter by team
        if (selectedTeams.size > 0) {
            const teamId = entry.product_item?.team?.id
            if (!teamId || !selectedTeams.has(teamId)) {
                return false
            }
        }

        // Filter by date range
        if (dateFrom || dateTo) {
            const entryDate = new Date(entry.date)
            if (dateFrom && entryDate < dateFrom) return false
            if (dateTo && entryDate > dateTo) return false
        }

        return true
    })

    // Group entries by month and generate columns (oldest first)
    const monthRange = generateMonthRange(filteredEntries)
    const entriesByMonth = new Map<string, ChangelogEntry[]>()

    // Initialize all months with empty arrays
    for (const monthKey of monthRange) {
        entriesByMonth.set(monthKey, [])
    }

    // Populate with filtered entries
    for (const entry of filteredEntries) {
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

    if (changelog.changelog_entries.length === 0) {
        return (
            <div className="ship-ui">
                <p className="ship-ui__empty">No changelog entries available.</p>
            </div>
        )
    }

    const hasProductAreas = (changelog.product_areas || []).length > 0
    const hasTeams = (changelog.teams || []).length > 0

    return (
        <div className="ship-ui">
            <div className="ship-ui__filters">
                <DateRangeDropdown value={dateRange} onChange={setDateRange} />
                {hasProductAreas && (
                    <MultiSelectDropdown
                        options={changelog.product_areas}
                        selectedIds={selectedProductAreas}
                        onChange={setSelectedProductAreas}
                        placeholder="Filter by product area"
                        emptyMessage="No product areas available"
                    />
                )}
                {hasTeams && (
                    <MultiSelectDropdown
                        options={changelog.teams}
                        selectedIds={selectedTeams}
                        onChange={setSelectedTeams}
                        placeholder="Filter by team"
                        emptyMessage="No teams available"
                    />
                )}
            </div>
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
                    <div className="changelog-card__date">Released: {formattedDate}</div>
                    {productArea && <div className="badge badge--product-area">Product Area: {productArea}</div>}
                    {role && <div className="badge badge--role">Team: {role}</div>}
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
