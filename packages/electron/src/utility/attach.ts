import type { UtilityProcess } from 'electron'
import { randomUUID } from 'node:crypto'
import { validateRequest, type Command, type Properties, type Response, type State } from '../shared/protocol'
import { envelope, readEnvelope, UTILITY_TIMEOUT_MS } from './protocol'

export interface UtilityRegistration {
    publish(state: State): void
    dispose(): void
}

export function attachUtilityProcess(
    child: UtilityProcess,
    execute: (command: Command, context: Properties, generation: number, authorize: () => void) => Promise<void>,
    getState: () => State,
    removed: () => void
): UtilityRegistration {
    const token = randomUUID()
    const context: Properties = { $electron_process: 'utility', $utility_process_id: randomUUID() }
    let active = true
    let connected = false
    let sequence = 0
    let requests = 0
    let period = performance.now()
    const pending = new Set<(error: Error) => void>()
    const authorize = (): void => {
        if (!active) throw new Error('PostHog utility process disconnected')
    }
    const send = (message: Record<string, unknown>): void => {
        if (!active) return
        try {
            const value = envelope(message)
            // Bound outbound state too: never flood a child with a large flag cache.
            readEnvelope(value, 'to-utility')
            child.postMessage(value)
        } catch {
            dispose()
        }
    }
    const dispose = (): void => {
        if (!active) return
        try {
            child.postMessage(envelope({ kind: 'closed', token }))
        } catch {}
        active = false
        clearTimeout(handshakeTimer)
        child.removeListener('message', message)
        child.removeListener('exit', dispose)
        for (const reject of pending) reject(new Error('PostHog utility process disconnected'))
        pending.clear()
        removed()
    }
    const message = (value: unknown): void => {
        if (!active) return
        let requestSequence: number | undefined
        try {
            const data = readEnvelope(value)
            if (!data) return
            if (performance.now() - period >= 1000) {
                period = performance.now()
                requests = 0
            }
            const rateLimited = ++requests > 100
            if (data.kind === 'connect') {
                if (rateLimited) throw new Error('PostHog utility rate limit exceeded')
                connected = true
                send({ kind: 'connected', token })
                return
            }
            if (!connected || data.kind !== 'request' || data.token !== token)
                throw new Error('Invalid PostHog utility connection')
            validateRequest(data.request)
            const request = data.request
            requestSequence = request.sequence
            if (request.sequence !== sequence + 1) throw new Error('Out-of-order PostHog utility request')
            if (request.sequence !== 1 && request.command.type === 'hello')
                throw new Error('Duplicate PostHog utility handshake')
            if (request.sequence === 1 && request.command.type !== 'hello')
                throw new Error('PostHog utility handshake required')
            sequence = request.sequence
            // Authenticated overload rejections consume their sequence so later work can recover.
            if (rateLimited) throw new Error('PostHog utility rate limit exceeded')
            if (pending.size >= 100) throw new Error('Too many pending PostHog utility requests')
            clearTimeout(handshakeTimer)
            let rejectClosed!: (error: Error) => void
            const closed = new Promise<never>((_resolve, reject) => {
                rejectClosed = reject
            })
            pending.add(rejectClosed)
            void Promise.race([execute(request.command, context, request.generation, authorize), closed])
                .then(() => {
                    authorize()
                    const response: Response = { ok: true, state: getState() }
                    send({ kind: 'response', token, sequence: request.sequence, response })
                })
                .catch((error: unknown) => {
                    send({
                        kind: 'response',
                        token,
                        sequence: request.sequence,
                        response: {
                            ok: false,
                            error: error instanceof Error ? error.message : 'PostHog utility request failed',
                        },
                    })
                })
                .finally(() => pending.delete(rejectClosed))
        } catch (error) {
            if (requestSequence !== undefined) {
                send({
                    kind: 'response',
                    token,
                    sequence: requestSequence,
                    response: {
                        ok: false,
                        error: error instanceof Error ? error.message : 'Invalid PostHog utility request',
                    },
                })
            } else dispose()
        }
    }
    // pid is undefined both before spawn and after exit; a bounded handshake handles both.
    const handshakeTimer = setTimeout(dispose, UTILITY_TIMEOUT_MS)
    handshakeTimer.unref()
    child.on('message', message)
    child.once('exit', dispose)
    return {
        publish: (state) => {
            if (connected) send({ kind: 'state', token, state })
        },
        dispose,
    }
}
