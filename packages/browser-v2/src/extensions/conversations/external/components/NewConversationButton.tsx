// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h, FunctionComponent } from 'preact'
import { getStyles } from './styles'

interface NewConversationButtonProps {
    styles: ReturnType<typeof getStyles>
    onClick: () => void
}

/**
 * Primary CTA used anywhere the user can start a fresh conversation —
 * the bottom of the ticket list and the resolved-state banner in the message view.
 */
export const NewConversationButton: FunctionComponent<NewConversationButtonProps> = ({ styles, onClick }) => (
    <button
        type="button"
        style={styles.newConversationButton}
        onClick={onClick}
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
)
