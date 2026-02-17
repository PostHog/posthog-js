// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h, FunctionComponent } from 'preact'
import { Ticket } from '../../../../posthog-conversations-types'
import { getStyles } from './styles'
import { TicketListItem } from './TicketListItem'

interface TicketListViewProps {
    tickets: Ticket[]
    isLoading: boolean
    styles: ReturnType<typeof getStyles>
    onSelectTicket: (ticketId: string) => void
    onNewConversation: () => void
}

/**
 * Loading state component
 */
const LoadingState: FunctionComponent<{ styles: ReturnType<typeof getStyles> }> = ({ styles }) => (
    <div style={styles.ticketListLoading}>
        <div style={styles.loadingSpinner} />
        <span>Loading conversations...</span>
    </div>
)

/**
 * Empty state component when there are no tickets
 */
const EmptyState: FunctionComponent<{
    styles: ReturnType<typeof getStyles>
    onNewConversation: () => void
}> = ({ styles, onNewConversation }) => (
    <div style={styles.ticketListEmpty}>
        <div style={styles.emptyStateIcon}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
        </div>
        <div style={styles.emptyStateTitle}>No conversations yet</div>
        <div style={styles.emptyStateDescription}>Start a new conversation to get help from our team.</div>
        <button
            style={styles.newConversationButtonLarge}
            onClick={onNewConversation}
            onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '0.9'
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '1'
            }}
        >
            Start a conversation
        </button>
    </div>
)

/**
 * Ticket list view showing all user's tickets
 */
export const TicketListView: FunctionComponent<TicketListViewProps> = ({
    tickets,
    isLoading,
    styles,
    onSelectTicket,
    onNewConversation,
}) => {
    // Show loading state
    if (isLoading && tickets.length === 0) {
        return <LoadingState styles={styles} />
    }

    // Show empty state when no tickets
    if (tickets.length === 0) {
        return <EmptyState styles={styles} onNewConversation={onNewConversation} />
    }

    // Show ticket list
    return (
        <div style={styles.ticketListContainer}>
            {/* Ticket list - sorted by most recent activity */}
            <div style={styles.ticketList}>
                {[...tickets]
                    .sort((a, b) => {
                        const dateA = new Date(a.last_message_at || a.created_at).getTime()
                        const dateB = new Date(b.last_message_at || b.created_at).getTime()
                        return dateB - dateA // Descending order (newest first)
                    })
                    .map((ticket) => (
                        <TicketListItem key={ticket.id} ticket={ticket} styles={styles} onClick={onSelectTicket} />
                    ))}
            </div>

            {/* New conversation button at bottom */}
            <button
                style={styles.newConversationButton}
                onClick={onNewConversation}
                onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '0.9'
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '1'
                }}
            >
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ marginRight: '8px' }}
                >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New conversation
            </button>
        </div>
    )
}
