// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h, Fragment } from 'preact'
import { useMemo } from 'preact/hooks'
import { isNull } from '@posthog/core'

interface MarkdownContentProps {
    content: string
    isCustomer: boolean
    primaryColor: string
}

interface ParsedNode {
    type: 'text' | 'bold' | 'italic' | 'underline' | 'code' | 'codeblock' | 'link' | 'image' | 'linebreak'
    content?: string
    url?: string
    alt?: string
}

/**
 * Sanitize URL to prevent javascript: and other dangerous protocols.
 * Only allows http:, https:, and relative URLs.
 * Uses simple string checks for IE11 compatibility (no URL constructor).
 */
function sanitizeUrl(url: string): string | undefined {
    if (!url || typeof url !== 'string') {
        return undefined
    }

    // Trim whitespace which could be used to bypass checks
    const trimmedUrl = url.trim()

    // Block empty URLs
    if (!trimmedUrl) {
        return undefined
    }

    // Block URLs that start with dangerous protocols (case-insensitive)
    const lowerUrl = trimmedUrl.toLowerCase()
    if (
        lowerUrl.startsWith('javascript:') ||
        lowerUrl.startsWith('vbscript:') ||
        lowerUrl.startsWith('data:') ||
        lowerUrl.startsWith('file:')
    ) {
        return undefined
    }

    // Allow relative URLs (start with /, ./, ../, or no protocol)
    if (
        trimmedUrl.startsWith('/') ||
        trimmedUrl.startsWith('./') ||
        trimmedUrl.startsWith('../') ||
        trimmedUrl.startsWith('#')
    ) {
        return trimmedUrl
    }

    // Allow http:// and https:// URLs
    if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) {
        return trimmedUrl
    }

    // Block anything else (unknown protocols, malformed URLs)
    return undefined
}

/** Maximum content length to parse (prevents DoS with huge messages) */
const MAX_CONTENT_LENGTH = 50000

/**
 * Simple markdown parser for chat messages
 * Supports: **bold**, *italic*, ++underline++, `code`, ```codeblock```, [links](url), ![images](url)
 */
function parseMarkdown(text: string): ParsedNode[] {
    // Safety check: limit input length to prevent performance issues
    if (!text || typeof text !== 'string') {
        return []
    }

    const safeText = text.length > MAX_CONTENT_LENGTH ? text.slice(0, MAX_CONTENT_LENGTH) : text

    const nodes: ParsedNode[] = []

    // First, handle code blocks (```...```)
    const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g
    let lastIndex = 0

    const textWithCodeBlocks: Array<{ type: 'text' | 'codeblock'; content: string }> = []

    let match = codeBlockRegex.exec(safeText)
    while (!isNull(match)) {
        if (match.index > lastIndex) {
            textWithCodeBlocks.push({ type: 'text', content: safeText.slice(lastIndex, match.index) })
        }
        textWithCodeBlocks.push({
            type: 'codeblock',
            content: match[2],
        })
        lastIndex = match.index + match[0].length
        match = codeBlockRegex.exec(safeText)
    }

    if (lastIndex < safeText.length) {
        textWithCodeBlocks.push({ type: 'text', content: safeText.slice(lastIndex) })
    }

    // Process each segment
    for (const segment of textWithCodeBlocks) {
        if (segment.type === 'codeblock') {
            nodes.push({
                type: 'codeblock',
                content: segment.content,
            })
        } else {
            // Parse inline markdown
            const inlineNodes = parseInlineMarkdown(segment.content)
            nodes.push(...inlineNodes)
        }
    }

    return nodes
}

function parseInlineMarkdown(text: string): ParsedNode[] {
    const nodes: ParsedNode[] = []

    // Combined regex for all inline patterns
    // Priority number is used to resolve conflicts when matches overlap (lower wins)
    const patterns = [
        // Images: ![alt](url)
        { regex: /!\[([^\]]*)\]\(([^)]+)\)/g, type: 'image' as const, priority: 1 },
        // Links: [text](url)
        { regex: /\[([^\]]+)\]\(([^)]+)\)/g, type: 'link' as const, priority: 2 },
        // Bold: **text** (must be checked before italic)
        { regex: /\*\*(.+?)\*\*/g, type: 'bold' as const, priority: 3 },
        // Underline: ++text++
        { regex: /\+\+(.+?)\+\+/g, type: 'underline' as const, priority: 4 },
        // Italic: *text* - uses negative lookbehind/lookahead to avoid matching **
        { regex: /(?<!\*)\*([^*]+)\*(?!\*)/g, type: 'italic' as const, priority: 5 },
        // Inline code: `code`
        { regex: /`([^`]+)`/g, type: 'code' as const, priority: 6 },
    ]

    // Find all matches with their positions
    interface MatchInfo {
        start: number
        end: number
        type: ParsedNode['type']
        content?: string
        url?: string
        alt?: string
        priority: number
    }

    const matches: MatchInfo[] = []

    for (const pattern of patterns) {
        const regex = new RegExp(pattern.regex.source, 'g')
        let match = regex.exec(text)
        while (!isNull(match)) {
            const matchInfo: MatchInfo = {
                start: match.index,
                end: match.index + match[0].length,
                type: pattern.type,
                priority: pattern.priority,
            }

            if (pattern.type === 'image') {
                matchInfo.alt = match[1]
                matchInfo.url = match[2]
            } else if (pattern.type === 'link') {
                matchInfo.content = match[1]
                matchInfo.url = match[2]
            } else {
                matchInfo.content = match[1]
            }

            matches.push(matchInfo)
            match = regex.exec(text)
        }
    }

    // Sort by position first, then by priority (lower priority number wins for overlaps)
    matches.sort((a, b) => a.start - b.start || a.priority - b.priority)

    const filteredMatches: MatchInfo[] = []
    let lastEnd = 0

    for (const match of matches) {
        if (match.start >= lastEnd) {
            filteredMatches.push(match)
            lastEnd = match.end
        }
    }

    // Build nodes
    let currentIndex = 0

    for (const match of filteredMatches) {
        // Add text before this match
        if (match.start > currentIndex) {
            const textContent = text.slice(currentIndex, match.start)
            nodes.push(...splitByLineBreaks(textContent))
        }

        // Add the matched node
        if (match.type === 'image') {
            nodes.push({ type: 'image', url: match.url, alt: match.alt })
        } else if (match.type === 'link') {
            nodes.push({ type: 'link', content: match.content, url: match.url })
        } else {
            nodes.push({ type: match.type, content: match.content })
        }

        currentIndex = match.end
    }

    // Add remaining text
    if (currentIndex < text.length) {
        const textContent = text.slice(currentIndex)
        nodes.push(...splitByLineBreaks(textContent))
    }

    return nodes
}

function splitByLineBreaks(text: string): ParsedNode[] {
    const nodes: ParsedNode[] = []
    const lines = text.split('\n')

    for (let i = 0; i < lines.length; i++) {
        if (lines[i]) {
            nodes.push({ type: 'text', content: lines[i] })
        }
        if (i < lines.length - 1) {
            nodes.push({ type: 'linebreak' })
        }
    }

    return nodes
}

function getStyles(isCustomer: boolean, primaryColor: string) {
    return {
        code: {
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
            fontSize: '0.9em',
            padding: '2px 4px',
            borderRadius: '3px',
            background: isCustomer ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.06)',
        },
        codeBlock: {
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
            fontSize: '0.85em',
            padding: '8px 10px',
            borderRadius: '6px',
            background: isCustomer ? 'rgba(255, 255, 255, 0.15)' : '#f4f4f5',
            overflowX: 'auto' as const,
            whiteSpace: 'pre-wrap' as const,
            wordWrap: 'break-word' as const,
            wordBreak: 'break-word' as const,
            margin: '8px 0',
            display: 'block',
            lineHeight: 1.5,
            border: isCustomer ? 'none' : '1px solid #e4e4e7',
        },
        link: {
            color: isCustomer ? 'white' : primaryColor,
            textDecoration: 'underline',
        },
        image: {
            maxWidth: '100%',
            borderRadius: '4px',
            marginTop: '4px',
            marginBottom: '4px',
            display: 'block',
        },
        bold: {
            fontWeight: 700,
        },
        italic: {
            fontStyle: 'italic' as const,
        },
        underline: {
            textDecoration: 'underline',
        },
    }
}

export function MarkdownContent({ content, isCustomer, primaryColor }: MarkdownContentProps) {
    const nodes = useMemo(() => parseMarkdown(content), [content])
    const styles = useMemo(() => getStyles(isCustomer, primaryColor), [isCustomer, primaryColor])

    const renderNode = (node: ParsedNode, index: number): preact.JSX.Element | null => {
        switch (node.type) {
            case 'text':
                return <span key={index}>{node.content}</span>
            case 'linebreak':
                return <br key={index} />
            case 'bold':
                return (
                    <strong key={index} style={styles.bold}>
                        {node.content}
                    </strong>
                )
            case 'italic':
                return (
                    <em key={index} style={styles.italic}>
                        {node.content}
                    </em>
                )
            case 'underline':
                return (
                    <u key={index} style={styles.underline}>
                        {node.content}
                    </u>
                )
            case 'code':
                return (
                    <code key={index} style={styles.code}>
                        {node.content}
                    </code>
                )
            case 'codeblock':
                return (
                    <pre key={index} style={styles.codeBlock}>
                        <code>{node.content}</code>
                    </pre>
                )
            case 'link': {
                const safeUrl = node.url ? sanitizeUrl(node.url) : undefined
                if (!safeUrl) {
                    // If URL is unsafe, render as plain text
                    return <span key={index}>{node.content}</span>
                }
                return (
                    <a
                        key={index}
                        href={safeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        referrerPolicy="no-referrer"
                        style={styles.link}
                    >
                        {node.content}
                    </a>
                )
            }
            case 'image': {
                const safeUrl = node.url ? sanitizeUrl(node.url) : undefined
                if (!safeUrl) {
                    // If URL is unsafe, don't render image
                    return null
                }
                return (
                    <img
                        key={index}
                        src={safeUrl}
                        alt={node.alt || ''}
                        style={styles.image}
                        onError={(e) => {
                            // Hide broken images
                            ;(e.target as HTMLImageElement).style.display = 'none'
                        }}
                    />
                )
            }
            default:
                return null
        }
    }

    return <>{nodes.map((node, index) => renderNode(node, index))}</>
}
