import React from 'react'
import { useAppSelector, useAppDispatch } from '../hooks'
import { setFilter, FilterType } from '../store'

export default function TodoFilters() {
    const dispatch = useAppDispatch()
    const filter = useAppSelector((state) => state.filter)

    const filters: { value: FilterType; label: string }[] = [
        { value: 'all', label: 'All' },
        { value: 'active', label: 'Active' },
        { value: 'completed', label: 'Completed' },
    ]

    return (
        <div className="filters">
            {filters.map((f) => (
                <button
                    key={f.value}
                    className={`filter-btn ${filter === f.value ? 'active' : ''}`}
                    onClick={() => dispatch(setFilter(f.value))}
                >
                    {f.label}
                </button>
            ))}
        </div>
    )
}
