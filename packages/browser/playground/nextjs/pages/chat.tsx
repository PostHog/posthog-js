import { useState, useEffect } from 'react'
import io, { Socket } from 'socket.io-client'
import { DefaultEventsMap } from 'socket.io'

const Chat = () => {
    // State to store the messages
    const [messages, setMessages] = useState<any[]>([])
    // State to store the current message
    const [currentMessage, setCurrentMessage] = useState('')
    const [socket, setSocket] = useState<Socket<DefaultEventsMap, DefaultEventsMap> | null>(null)

    useEffect(() => {
        // Create a socket connection
        const createdSocket = io()

        // Listen for incoming messages
        createdSocket.on('message', (message) => {
            setMessages((prevMessages) => [...prevMessages, message])
        })

        setSocket(createdSocket)

        // Clean up the socket connection on unmount
        return () => {
            createdSocket.disconnect()
        }
    }, [])

    const sendMessage = () => {
        if (!socket) {
            // eslint-disable-next-line no-console
            console.log('socket not running, ruh roh!')
            return
        }

        socket.emit('send chat message', currentMessage)
        setCurrentMessage('')
    }

    return (
        <div className={'w-full min-h-96 flex-col space-y-2'}>
            <div className="flex flex-row justify-between items-center border border-gray-300 rounded p-2 space-x-2">
                <input
                    className={'flex-1 border rounded px-2 py-1'}
                    type="text"
                    value={currentMessage}
                    onChange={(e) => setCurrentMessage(e.target.value)}
                />

                <button onClick={sendMessage}>Send</button>
            </div>

            <div className="flex flex-col border rounded px-2 py-1">
                {messages?.length === 0 && <p>No messages yet</p>}
                {/* Display the messages */}
                {messages
                    .filter((m) => !!m.trim().length)
                    .map((message, index) => (
                        <p className={'w-full border rounded px-2 py-1'} key={index}>
                            {message}
                        </p>
                    ))}
            </div>
        </div>
    )
}

export default Chat
