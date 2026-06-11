import { useActions, useValues } from 'kea'
import { todoLogic, FilterType } from '../../todoLogic'

export default function TodoFilters() {
    const { filter } = useValues(todoLogic)
    const { setFilter } = useActions(todoLogic)

    const filters: { key: FilterType; label: string }[] = [
        { key: 'all', label: 'All' },
        { key: 'active', label: 'Active' },
        { key: 'completed', label: 'Completed' },
    ]

    return (
        <div className="filters">
            {filters.map((filterOption) => (
                <button
                    key={filterOption.key}
                    onClick={() => setFilter(filterOption.key)}
                    className={`filter-btn ${filter === filterOption.key ? 'active' : ''}`}
                >
                    {filterOption.label}
                </button>
            ))}
        </div>
    )
}
