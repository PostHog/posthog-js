// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h, Fragment } from 'preact'
import { useMemo } from 'preact/hooks'
import { isUndefined, isNumber, isArray } from '@posthog/core'
import { TipTapDoc, TipTapNode, TipTapMark } from '../../../../posthog-conversations-types'

interface RichContentProps {
    /** Rich content in TipTap JSON format (preferred) */
    richContent?: TipTapDoc
    /** Plain text fallback if rich_content is missing or invalid */
    content: string
    /** Whether message is from customer (affects styling) */
    isCustomer: boolean
    /** Primary color for links */
    primaryColor: string
}

/**
 * Sanitize URL to prevent javascript: and other dangerous protocols.
 * Only allows http:, https:, mailto:, tel:, and relative URLs.
 *
 * Security measures:
 * - Removes ASCII control characters (0x00-0x1F, 0x7F) that could obfuscate protocols
 * - Removes Unicode whitespace and zero-width characters
 * - Collapses whitespace when checking protocols to prevent "java script:" bypasses
 * - Blocks javascript:, vbscript:, data:, and file: protocols
 * - Blocks protocol-relative URLs (//example.com)
 */
function sanitizeUrl(url: string): string | undefined {
    if (!url || typeof url !== 'string') {
        return undefined
    }

    // Remove ASCII control characters (0x00-0x1F, 0x7F DEL) that could obfuscate protocols
    // Also remove zero-width characters (U+200B-U+200D, U+FEFF) that could be used for obfuscation
    // eslint-disable-next-line no-control-regex
    const cleanedUrl = url.replace(/[\x00-\x1f\x7f\u200b-\u200d\ufeff]/g, '')
    const trimmedUrl = cleanedUrl.trim()
    if (!trimmedUrl) {
        return undefined
    }

    // Collapse all whitespace (including Unicode whitespace) when checking protocol
    // This prevents bypasses like "java script:" or "java\u00A0script:" (non-breaking space)
    const normalizedForCheck = trimmedUrl.replace(/\s+/g, '').toLowerCase()

    // Block dangerous protocols
    if (
        normalizedForCheck.startsWith('javascript:') ||
        normalizedForCheck.startsWith('vbscript:') ||
        normalizedForCheck.startsWith('data:') ||
        normalizedForCheck.startsWith('file:')
    ) {
        return undefined
    }

    // Allow relative URLs (check against trimmed URL, not normalized)
    // Note: We explicitly check for '//' first to block protocol-relative URLs (e.g., //evil.com)
    // which could be used to load content from attacker-controlled domains
    if (trimmedUrl.startsWith('//')) {
        return undefined
    }
    if (
        trimmedUrl.startsWith('/') ||
        trimmedUrl.startsWith('./') ||
        trimmedUrl.startsWith('../') ||
        trimmedUrl.startsWith('#')
    ) {
        return trimmedUrl
    }

    // Allow safe absolute URLs
    const lowerUrl = trimmedUrl.toLowerCase()
    if (
        lowerUrl.startsWith('http://') ||
        lowerUrl.startsWith('https://') ||
        lowerUrl.startsWith('mailto:') ||
        lowerUrl.startsWith('tel:')
    ) {
        return trimmedUrl
    }

    return undefined
}

/** Maximum recursion depth to prevent stack overflow */
const MAX_DEPTH = 20

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
    }
}

/**
 * Render a text node with its marks (bold, italic, underline, etc.)
 * Marks are applied by wrapping the content in nested elements.
 */
function renderTextWithMarks(
    text: string,
    marks: TipTapMark[] | undefined,
    styles: ReturnType<typeof getStyles>,
    key: string
): preact.JSX.Element {
    if (!marks || marks.length === 0) {
        return <span key={key}>{text}</span>
    }

    // Build the element by wrapping with marks from inside out
    let element: preact.JSX.Element = <>{text}</>

    for (const mark of marks) {
        switch (mark.type) {
            case 'bold':
                element = <strong style={{ fontWeight: 700 }}>{element}</strong>
                break
            case 'italic':
                element = <em style={{ fontStyle: 'italic' }}>{element}</em>
                break
            case 'underline':
                element = <u style={{ textDecoration: 'underline' }}>{element}</u>
                break
            case 'strike':
                element = <s style={{ textDecoration: 'line-through' }}>{element}</s>
                break
            case 'code':
                element = <code style={styles.code}>{element}</code>
                break
            case 'link': {
                const href = mark.attrs?.href
                const safeUrl = typeof href === 'string' ? sanitizeUrl(href) : undefined
                if (safeUrl) {
                    element = (
                        <a
                            href={safeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            referrerpolicy="no-referrer"
                            style={styles.link}
                        >
                            {element}
                        </a>
                    )
                }
                break
            }
            // Ignore unknown mark types for safety
        }
    }

    return <span key={key}>{element}</span>
}

/**
 * Recursively render a TipTap node and its children
 */
function renderNode(
    node: TipTapNode | TipTapDoc,
    styles: ReturnType<typeof getStyles>,
    depth: number,
    key: string
): preact.JSX.Element | null {
    // Safety: prevent infinite recursion
    if (depth > MAX_DEPTH) {
        return null
    }

    // Text node with optional marks
    if (node.type === 'text' && !isUndefined(node.text)) {
        return renderTextWithMarks(node.text, node.marks, styles, key)
    }

    // Render children recursively
    const children = node.content?.map((child, index) => renderNode(child, styles, depth + 1, `${key}-${index}`)) || []

    switch (node.type) {
        case 'doc':
            return <>{children}</>

        case 'paragraph':
            return (
                <p key={key} style={{ margin: '0 0 8px 0' }}>
                    {children.length > 0 ? children : <br />}
                </p>
            )

        case 'hardBreak':
            return <br key={key} />

        case 'codeBlock': {
            // Code blocks store text in content[0].text
            const codeText = node.content?.[0]?.text || ''
            return (
                <pre key={key} style={styles.codeBlock}>
                    <code>{codeText}</code>
                </pre>
            )
        }

        case 'image': {
            const src = node.attrs?.src
            const alt = node.attrs?.alt
            const safeUrl = typeof src === 'string' ? sanitizeUrl(src) : undefined
            if (!safeUrl) {
                return null
            }
            return (
                <img
                    key={key}
                    src={safeUrl}
                    alt={typeof alt === 'string' ? alt : ''}
                    style={styles.image}
                    onError={(e) => {
                        ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                />
            )
        }

        case 'bulletList':
            return (
                <ul key={key} style={{ margin: '8px 0', paddingLeft: '24px' }}>
                    {children}
                </ul>
            )

        case 'orderedList':
            return (
                <ol key={key} style={{ margin: '8px 0', paddingLeft: '24px' }}>
                    {children}
                </ol>
            )

        case 'listItem':
            return (
                <li key={key} style={{ margin: '4px 0' }}>
                    {children}
                </li>
            )

        case 'blockquote':
            return (
                <blockquote
                    key={key}
                    style={{
                        margin: '8px 0',
                        paddingLeft: '12px',
                        borderLeft: '3px solid #e4e4e7',
                        color: '#71717a',
                    }}
                >
                    {children}
                </blockquote>
            )

        case 'heading': {
            const rawLevel = node.attrs?.level
            const level = isNumber(rawLevel) ? rawLevel : 1
            const HeadingTag = `h${Math.min(Math.max(level, 1), 6)}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
            return (
                <HeadingTag key={key} style={{ margin: '12px 0 8px 0' }}>
                    {children}
                </HeadingTag>
            )
        }

        case 'horizontalRule':
            return <hr key={key} style={{ margin: '12px 0', border: 'none', borderTop: '1px solid #e4e4e7' }} />

        default:
            // Unknown node types: render children if any, otherwise ignore
            if (children.length > 0) {
                return <span key={key}>{children}</span>
            }
            return null
    }
}

/**
 * Validate that the content looks like a valid TipTap document
 */
function isValidTipTapDoc(doc: unknown): doc is TipTapDoc {
    if (!doc || typeof doc !== 'object') {
        return false
    }
    const d = doc as TipTapDoc
    return d.type === 'doc' && (isUndefined(d.content) || isArray(d.content))
}

/**
 * Render plain text with line breaks preserved
 */
function renderPlainText(text: string): preact.JSX.Element {
    if (!text) {
        return <></>
    }
    const lines = text.split('\n')
    return (
        <>
            {lines.map((line, index) => (
                <Fragment key={index}>
                    {line}
                    {index < lines.length - 1 && <br />}
                </Fragment>
            ))}
        </>
    )
}

/**
 * RichContent component - renders TipTap JSON content with plain text fallback
 *
 * Rendering logic:
 * 1. If richContent is present and valid, render as TipTap tree
 * 2. If richContent is missing or invalid, fall back to plain text content
 * 3. Wrap TipTap rendering in try/catch for safety
 */
export function RichContent({ richContent, content, isCustomer, primaryColor }: RichContentProps) {
    const styles = useMemo(() => getStyles(isCustomer, primaryColor), [isCustomer, primaryColor])

    // Try to render rich content if available
    if (richContent) {
        try {
            if (isValidTipTapDoc(richContent)) {
                const rendered = renderNode(richContent, styles, 0, 'root')
                if (rendered) {
                    return rendered
                }
            }
        } catch {
            // Fall through to plain text on any error
        }
    }

    // Fallback: render plain text content
    return renderPlainText(content)
}
