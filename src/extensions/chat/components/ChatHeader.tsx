import { BRAND_COLOR } from './style'

export function ChatHeader() {
    return (
        <div style={{ height: 150, backgroundColor: BRAND_COLOR, color: 'white' }}>
            <span>Questions? Chat with us!</span>
            <div>
                <div style={{ width: 8, height: 8, borderRadius: 8, backgroundColor: 'rgb(78, 206, 61)' }}></div>
                <span>Typically replies under an hour</span>
            </div>
        </div>
    )
}
