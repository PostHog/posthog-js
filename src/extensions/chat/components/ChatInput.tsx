import { useState } from 'preact/hooks'
import { BRAND_COLOR } from './style'

export function ChatInput({ sendMessage }: { sendMessage: (message: string) => void }) {
    const [message, setMessage] = useState('')
    return (
        <div style={{ display: 'flex', paddingLeft: 8, paddingRight: 8, marginBottom: 8 }}>
            <input
                type="text"
                placeholder="Type your message here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                style={{
                    width: '100%',
                    height: 40,
                    borderRadius: 8,
                    border: 'none',
                    outline: 'none',
                    padding: '0 10px',
                    boxSizing: 'border-box',
                }}
            />
            <div
                style={{
                    cursor: 'pointer',
                    backgroundColor: BRAND_COLOR,
                    color: 'white',
                    borderRadius: 10,
                    display: 'flex',
                    alignItems: 'center',
                }}
                onClick={() => sendMessage(message)}
            >
                Send
            </div>
        </div>
    )
}
