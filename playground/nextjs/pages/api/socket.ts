import { Server } from 'socket.io'
import type { NextApiRequest, NextApiResponse } from 'next'
import type { Server as HttpServer } from 'http'
import type { Socket as NetSocket } from 'net'

// Extend the response object to include the custom `io` property
interface CustomServer extends HttpServer {
    io?: Server
}

interface CustomNetSocket extends NetSocket {
    server: CustomServer
}

interface CustomNextApiResponse extends NextApiResponse {
    socket: CustomNetSocket
}

export default function handler(req: NextApiRequest, res: CustomNextApiResponse) {
    if (!res.socket.server.io) {
        const io = new Server(res.socket.server)
        res.socket.server.io = io

        io.on('connection', (socket) => {
            // eslint-disable-next-line no-console
            console.log('User connected', socket.id)

            socket.on('send chat message', (msg) => {
                socket.emit('message', msg)
            })

            socket.on('disconnect', () => {
                // eslint-disable-next-line no-console
                console.log('User disconnected', socket.id)
            })
        })
    }
    res.end()
}
