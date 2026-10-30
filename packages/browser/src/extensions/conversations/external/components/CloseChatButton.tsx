import { getStyles } from './styles'

interface CloseChatButtonProps {
    styles: ReturnType<typeof getStyles>
    handleClose: () => void
}

export const CloseChatButton = ({ styles, handleClose }: CloseChatButtonProps) => {
    return (
        <button
            style={styles.headerButton}
            onClick={handleClose}
            aria-label="Close"
            onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'
                e.currentTarget.style.opacity = '1'
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.opacity = '0.9'
            }}
        >
            ✕
        </button>
    )
}
