import { ChatMessageType } from './ChatMessages'
import { SystemAvatar } from './PosthogAvatar'
import { BRAND_COLOR } from './style'

export function ChatMessage({ message }: { message: ChatMessageType }) {
    if (message.is_assistant) {
        return (
            <div style={{ width: 284, display: 'flex' }}>
                <SystemAvatar />
                <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 10, color: 'rgb(146, 169, 193)' }}>Assistant</span>
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
                            textAlign: 'left',
                        }}
                    >
                        {message.content}
                    </span>
                    <span style={{ fontSize: 10, color: 'rgb(146, 169, 193)' }}>
                        {new Date(message.created_at).toLocaleTimeString()}
                    </span>
                </div>
            </div>
        )
    }

    return (
        <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: 284 }}>
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        marginLeft: 8,
                        marginTop: 4,
                        alignItems: 'flex-end',
                    }}
                >
                    <span
                        style={{
                            fontSize: 12,
                            backgroundColor: 'rgb(240, 242, 245)',
                            color: 'rgb(28, 41, 59)',
                            paddingLeft: 14,
                            paddingRight: 14,
                            paddingTop: 8,
                            paddingBottom: 9,
                            borderRadius: 10,
                            overflow: 'hidden',
                            textAlign: 'right',
                        }}
                    >
                        {message.content}
                    </span>
                    <span style={{ fontSize: 10, color: 'rgb(146, 169, 193)' }}>
                        {new Date(message.created_at).toLocaleTimeString()}
                    </span>
                </div>
            </div>
        </div>
    )
}
