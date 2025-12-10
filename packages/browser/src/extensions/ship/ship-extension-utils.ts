import { ChangelogEntry, EarlyAccessFeatureStage } from '../../types'
import { FeatureStageConfig } from './components/FeatureEnrollmentUI'

export function formatMonthTitle(year: number, month: number): string {
    const date = new Date(year, month)
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export function getMonthKey(dateString: string): string {
    const date = new Date(dateString)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    return `${year}-${month}`
}

export function parseMonthKey(key: string): { year: number; month: number } {
    const [year, month] = key.split('-').map(Number)
    return { year, month: month - 1 } // month is 0-indexed for Date
}

export function generateMonthRange(entries: ChangelogEntry[]): string[] {
    if (entries.length === 0) {
        return []
    }

    // Get all unique month keys from entries
    const monthKeys = new Set(entries.map((e) => getMonthKey(e.date)))

    // Find min and max months
    const sortedKeys = Array.from(monthKeys).sort()
    const minKey = sortedKeys[0]
    const maxKey = sortedKeys[sortedKeys.length - 1]

    const { year: minYear, month: minMonth } = parseMonthKey(minKey)
    const { year: maxYear, month: maxMonth } = parseMonthKey(maxKey)

    // Generate all months between min and max (inclusive)
    const allMonths: string[] = []
    let currentYear = minYear
    let currentMonth = minMonth

    while (currentYear < maxYear || (currentYear === maxYear && currentMonth <= maxMonth)) {
        const key = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`
        allMonths.push(key)

        currentMonth++
        if (currentMonth > 11) {
            currentMonth = 0
            currentYear++
        }
    }

    return allMonths
}
export const FEATURE_STAGE_CONFIGS: FeatureStageConfig[] = [
    { stage: 'concept', title: 'Ideas', description: 'Features we are considering' },
    { stage: 'alpha', title: 'In progress', description: 'Currently being built' },
    { stage: 'beta', title: 'Early access', description: 'Available to try now' },
    { stage: 'general-availability', title: 'Released', description: 'Generally available' },
]

export const ALL_STAGES: EarlyAccessFeatureStage[] = ['concept', 'alpha', 'beta', 'general-availability']
