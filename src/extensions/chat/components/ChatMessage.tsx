import { ChatMessageType } from './ChatMessages'
import { BUSINESS_NAME } from './constants'
import { SystemAvatar } from './PosthogAvatar'
import { BRAND_COLOR } from './style'

export function ChatMessage({ message }: { message: ChatMessageType }) {
    return (
        <div style={{ width: 284 }}>
            <SystemAvatar />
            <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 8, marginTop: 4 }}>
                <span style={{ fontSize: 8, color: 'rgb(146, 169, 193)' }}>{BUSINESS_NAME}</span>
                <span
                    style={{
                        fontSize: 12,
                        backgroundColor: BRAND_COLOR,
                        color: 'white',
                        paddingLeft: 14,
                        paddingRight: 14,
                        paddingTop: 8,
                        paddingBottom: 9,
                        borderRadius: 10,
                        overflow: 'hidden',
                    }}
                >
                    {message.content}
                </span>
            </div>
        </div>
    )
}
