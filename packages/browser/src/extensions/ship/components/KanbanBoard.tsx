import { addEventListener } from '../../../utils'
import { useState, useEffect, useRef } from 'preact/hooks'
import * as Preact from 'preact'

export interface KanbanColumn<T> {
    id: string
    title: string
    description: string
    items: T[]
}

export interface KanbanBoardProps<T> {
    columns: KanbanColumn<T>[]
    renderItem: (item: T) => Preact.JSX.Element
    getItemKey: (item: T) => string
    emptyMessage?: string
    /** When true, right-aligns content so user scrolls left to see older items */
    rightAlign?: boolean
}

export function KanbanBoard<T>({
    columns,
    renderItem,
    getItemKey,
    emptyMessage = 'No items',
    rightAlign = false,
}: KanbanBoardProps<T>): Preact.JSX.Element {
    const containerRef = useRef<HTMLDivElement>(null)
    const [showJumpButton, setShowJumpButton] = useState(false)

    useEffect(() => {
        const container = containerRef.current
        if (!container || !rightAlign) return

        const checkScroll = () => {
            // For RTL, scrollLeft is negative (or 0 at rightmost)
            // Show button when scrolled away from the right edge
            const isScrolledLeft = container.scrollLeft < -50
            setShowJumpButton(isScrolledLeft)
        }

        // Initial check
        checkScroll()

        addEventListener(container, 'scroll', checkScroll)
        return () => container.removeEventListener('scroll', checkScroll)
    }, [rightAlign])

    const handleJumpToRight = () => {
        const container = containerRef.current
        if (!container) return
        container.scrollTo({ left: 0, behavior: 'smooth' })
    }

    return (
        <div className="kanban-wrapper">
            <div ref={containerRef} className={`kanban ${rightAlign ? 'kanban--right-align' : ''}`}>
                {columns.map((column) => (
                    <div key={column.id} className="kanban__column">
                        <div className="kanban__column-header">
                            <h3 className="kanban__column-title">
                                {column.title}
                                {column.items.length > 0 && (
                                    <span className="kanban__column-count">{column.items.length}</span>
                                )}
                            </h3>
                            <p className="kanban__column-description">{column.description}</p>
                        </div>
                        <div className="kanban__column-content">
                            {column.items.length === 0 ? (
                                <div className="kanban__empty">{emptyMessage}</div>
                            ) : (
                                column.items.map((item) => (
                                    <Preact.Fragment key={getItemKey(item)}>{renderItem(item)}</Preact.Fragment>
                                ))
                            )}
                        </div>
                    </div>
                ))}
            </div>
            {rightAlign && showJumpButton && (
                <button
                    type="button"
                    className="kanban__jump-btn"
                    onClick={handleJumpToRight}
                    aria-label="Back to latest"
                >
                    Back to latest →
                </button>
            )}
        </div>
    )
}
