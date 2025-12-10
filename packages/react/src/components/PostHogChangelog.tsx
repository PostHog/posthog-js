import React, { useEffect, useRef } from 'react'
import { usePostHog } from '../hooks'

export type PostHogChangelogProps = Omit<React.HTMLProps<HTMLDivElement>, 'ref'>

/**
 * A React component that renders the PostHog Changelog UI.
 * This displays product updates and changelog entries in a kanban-style board
 * organized by month.
 *
 * The component renders into a Shadow DOM for style isolation, so it won't
 * be affected by your app's styles and won't leak its styles into your app.
 *
 * @example
 * ```tsx
 * import { PostHogChangelog } from '@posthog/react'
 *
 * function WhatsNewPage() {
 *   return (
 *     <div>
 *       <h1>What's New</h1>
 *       <PostHogChangelog />
 *     </div>
 *   )
 * }
 * ```
 */
export function PostHogChangelog({ ...props }: PostHogChangelogProps): React.ReactElement {
    const containerRef = useRef<HTMLDivElement>(null)
    const posthog = usePostHog()
    const unmountRef = useRef<(() => void) | null>(null)

    useEffect(() => {
        const container = containerRef.current
        if (!container || !posthog) {
            return
        }

        // Use the renderChangelog method on the PostHog instance
        // which delegates to the ship extension
        unmountRef.current = posthog.renderChangelog(container)

        return () => {
            if (unmountRef.current) {
                unmountRef.current()
                unmountRef.current = null
            }
        }
    }, [posthog])

    return <div ref={containerRef} style={{ width: '100%', height: '100%' }} {...props} />
}
