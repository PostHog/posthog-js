// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h, FunctionComponent } from 'preact'
import { Ticket, TicketStatus } from '../../../../posthog-conversations-types'
import { getStyles } from './styles'
import { formatRelativeTime, truncateText } from './utils'

interface TicketListItemProps {
    ticket: Ticket
    styles: ReturnType<typeof getStyles>
    onClick: (ticketId: string) => void
}

/**
 * Get a human-readable status label
 * Matches the display logic in PostHog main app
 */
function getStatusLabel(status: TicketStatus): string {
    if (status === 'on_hold') {
        return 'On hold'
    }
    // Capitalize first letter: 'new' -> 'New', 'open' -> 'Open', etc.
    return status.charAt(0).toUpperCase() + status.slice(1)
}

/**
 * A single ticket item in the ticket list
 */
export const TicketListItem: FunctionComponent<TicketListItemProps> = ({ ticket, styles, onClick }) => {
    const hasUnread = (ticket.unread_count || 0) > 0
    const statusLabel = getStatusLabel(ticket.status)

    const handleClick = () => {
        onClick(ticket.id)
    }

    const itemStyle = {
        ...styles.ticketItem,
        ...(hasUnread ? styles.ticketItemUnread : {}),
    }

    return (
        <div
            style={itemStyle}
            onClick={handleClick}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleClick()
                }
            }}
            role="button"
            tabIndex={0}
        >
            <div style={styles.ticketItemContent}>
                <div style={styles.ticketItemHeader}>
                    <span style={hasUnread ? styles.ticketPreviewUnread : styles.ticketPreview}>
                        {truncateText(ticket.last_message, 60)}
                    </span>
                    {hasUnread && <span style={styles.ticketUnreadBadge}>{ticket.unread_count}</span>}
                </div>
                <div style={styles.ticketMeta}>
                    <span style={styles.ticketTime}>
                        {formatRelativeTime(ticket.last_message_at || ticket.created_at)}
                    </span>
                    <span style={styles.ticketStatus}>{statusLabel}</span>
                </div>
            </div>
            {/* Right arrow indicator */}
            <div style={styles.ticketItemArrow}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </div>
        </div>
    )
}
