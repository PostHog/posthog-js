/**
 * Format a timestamp to a relative time string
 */
export function formatRelativeTime(isoString: string | undefined): string {
    if (!isoString) {
        return ''
    }

    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) {
        return 'Just now'
    } else if (diffMins < 60) {
        return `${diffMins}m ago`
    } else if (diffHours < 24) {
        return `${diffHours}h ago`
    } else if (diffDays === 1) {
        return 'Yesterday'
    } else if (diffDays < 7) {
        return `${diffDays}d ago`
    } else {
        return date.toLocaleDateString()
    }
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncateText(text: string | undefined, maxLength: number): string {
    if (!text) {
        return 'No messages yet'
    }
    if (text.length <= maxLength) {
        return text
    }
    return text.substring(0, maxLength - 3) + '...'
}
