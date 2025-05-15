export function ChatInput() {
    return (
        <div>
            <input
                type="text"
                placeholder="Type your message here..."
                style={{
                    width: '100%',
                    height: 40,
                    borderRadius: 8,
                    border: '1px solid #ccc',
                    padding: '0 10px',
                    boxSizing: 'border-box',
                }}
            />
        </div>
    )
}
