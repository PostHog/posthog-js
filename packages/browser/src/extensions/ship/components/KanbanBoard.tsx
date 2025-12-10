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
}

export function KanbanBoard<T>({
    columns,
    renderItem,
    getItemKey,
    emptyMessage = 'No items',
}: KanbanBoardProps<T>): Preact.JSX.Element {
    return (
        <div className="kanban">
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
    )
}
