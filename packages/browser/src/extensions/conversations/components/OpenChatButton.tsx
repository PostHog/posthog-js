import { getStyles } from './styles'

interface OpenChatButtonProps {
    primaryColor: string
    handleToggleOpen: () => void
}

export const OpenChatButton = ({ primaryColor, handleToggleOpen }: OpenChatButtonProps) => {
    const styles = getStyles(primaryColor)
    return (
        <div style={styles.widget}>
            <button
                style={styles.button}
                onClick={handleToggleOpen}
                aria-label="Open chat"
                onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.05)'
                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.2)'
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)'
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)'
                }}
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                        d="M12 2C6.48 2 2 6.48 2 12C2 13.93 2.6 15.71 3.64 17.18L2.5 21.5L7.04 20.42C8.46 21.28 10.17 21.75 12 21.75C17.52 21.75 22 17.27 22 11.75C22 6.23 17.52 2 12 2Z"
                        fill="currentColor"
                    />
                </svg>
            </button>
        </div>
    )
}
