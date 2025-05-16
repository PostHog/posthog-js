import { BRAND_COLOR } from './style'

export function ChatHeader() {
    return (
        <div
            style={{
                height: 150,
                backgroundColor: BRAND_COLOR,
                color: 'white',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: 16,
            }}
        >
            <span style={{ fontSize: 11, fontWeight: 'bold' }}>Questions? Chat with us!</span>
            <div style={{ display: 'flex', alignItems: 'center' }}>
                <div
                    style={{
                        width: 8,
                        height: 8,
                        borderRadius: 8,
                        backgroundColor: 'rgb(78, 206, 61)',
                        marginRight: 8,
                    }}
                ></div>
                <span style={{ fontSize: 11 }}>Typically replies under an hour</span>
            </div>
        </div>
    )
}
