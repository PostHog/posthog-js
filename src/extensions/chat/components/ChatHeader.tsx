import { BRAND_COLOR } from './style'

export function ChatHeader() {
    return (
        <div
            style={{
                backgroundColor: BRAND_COLOR,
                color: 'white',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: 16,
            }}
        >
            <span style={{ fontSize: 11, fontWeight: 'bold' }}>Questions? Chat with us!</span>
        </div>
    )
}
