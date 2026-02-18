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

/**
 * Strip markdown formatting from text for plain text display
 * Lightweight regex-based approach without external dependencies
 */
export function stripMarkdown(text: string | undefined): string {
    if (!text) {
        return ''
    }

    return (
        text
            // Remove code blocks first (before other processing)
            .replace(/```[\s\S]*?```/g, '')
            // Remove inline code
            .replace(/`([^`]+)`/g, '$1')
            // Remove images
            .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
            // Convert links to just text
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            // Remove headers
            .replace(/^#{1,6}\s+/gm, '')
            // Remove blockquotes
            .replace(/^>\s*/gm, '')
            // Remove horizontal rules (must be before list markers to avoid conflicts)
            .replace(/^[-*_]{3,}\s*$/gm, '')
            // Remove list markers (must be before bold/italic to avoid conflicts with *)
            .replace(/^[\s]*[-*+]\s+/gm, '')
            .replace(/^[\s]*\d+\.\s+/gm, '')
            // Remove bold/italic (order matters: ** before *)
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            .replace(/__([^_]+)__/g, '$1')
            .replace(/_([^_]+)_/g, '$1')
            // Remove strikethrough
            .replace(/~~([^~]+)~~/g, '$1')
            // Remove HTML angle brackets entirely to prevent partial tags
            .replace(/[<>]/g, '')
            // Collapse multiple newlines
            .replace(/\n{2,}/g, '\n')
            // Trim whitespace
            .trim()
    )
}
