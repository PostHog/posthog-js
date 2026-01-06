import { getStyles } from './styles'

interface SendMessageButtonProps {
    primaryColor: string
    inputValue: string
    isLoading: boolean
    handleSendMessage: () => void
}

export const SendMessageButton = ({
    primaryColor,
    inputValue,
    isLoading,
    handleSendMessage,
}: SendMessageButtonProps) => {
    const styles = getStyles(primaryColor)
    return (
        <button
            style={{
                ...styles.sendButton,
                opacity: !inputValue.trim() || isLoading ? 0.6 : 1,
                cursor: !inputValue.trim() || isLoading ? 'not-allowed' : 'pointer',
            }}
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isLoading}
            aria-label="Send message"
            onMouseEnter={(e) => {
                if (!e.currentTarget.disabled) {
                    e.currentTarget.style.transform = 'scale(1.02)'
                    e.currentTarget.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.1)'
                }
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)'
                e.currentTarget.style.boxShadow = '0 2px 0 rgba(0, 0, 0, 0.045)'
            }}
        >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                    d="M2 10L18 2L10 18L8 11L2 10Z"
                    fill="currentColor"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                />
            </svg>
        </button>
    )
}
