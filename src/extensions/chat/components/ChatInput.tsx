import { useState } from 'preact/hooks'
import { BRAND_COLOR } from './style'

export function ChatInput({ sendMessage }: { sendMessage: (message: string) => void }) {
    const [message, setMessage] = useState('')
    return (
        <div style={{ display: 'flex', padding: 8, borderTop: `1px solid ${BRAND_COLOR}` }}>
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
                    justifyContent: 'center',
                    padding: '5px 10px',
                    fontSize: 12,
                    fontWeight: 300,
                }}
                onClick={() => sendMessage(message)}
            >
                Send
            </div>
        </div>
    )
}
