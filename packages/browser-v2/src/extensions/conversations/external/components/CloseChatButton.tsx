import { getStyles } from './styles'

interface CloseChatButtonProps {
    primaryColor: string
    handleClose: () => void
}

export const CloseChatButton = ({ primaryColor, handleClose }: CloseChatButtonProps) => {
    const styles = getStyles(primaryColor)
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
