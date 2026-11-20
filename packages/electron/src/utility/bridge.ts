import type { ParentPort } from 'electron'
import type { Bridge, Request, Response, State } from '../shared/protocol'
import { envelope, isResponse, isState, readEnvelope, UTILITY_TIMEOUT_MS } from './protocol'

export function createUtilityBridge(port: ParentPort): Bridge {
    let token: string | undefined
    let closed = false
    const listeners = new Set<(state: State) => void>()
    const pending = new Map<
        number,
        { resolve: (value: Response) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
    >()
    let connectedResolve!: () => void
    let connectedReject!: (error: Error) => void
    const connected = new Promise<void>((resolve, reject) => {
        connectedResolve = resolve
        connectedReject = reject
    })
    // Disposal may precede the facade's first request.
    void connected.catch(() => {})
    const timer = setTimeout(() => close(new Error('PostHog utility connection timed out')), UTILITY_TIMEOUT_MS)
    const close = (error: Error): void => {
        if (closed) return
        closed = true
        clearTimeout(timer)
        port.removeListener('message', message)
        connectedReject(error)
        for (const operation of pending.values()) {
            clearTimeout(operation.timer)
            operation.reject(error)
        }
        pending.clear()
        listeners.clear()
    }
    const message = (event: Electron.MessageEvent): void => {
        try {
            const data = readEnvelope(event.data, 'to-utility')
            if (!data) return
            if (data.kind === 'connected' && typeof data.token === 'string' && data.token.length <= 128) {
                if (token && token !== data.token) throw new Error('PostHog utility connection changed')
                token = data.token
                clearTimeout(timer)
                connectedResolve()
                return
            }
            if (!token || data.token !== token) throw new Error('Invalid PostHog utility connection')
            if (data.kind === 'closed') {
                close(new Error('PostHog utility connection closed'))
            } else if (data.kind === 'state' && isState(data.state)) {
                for (const listener of listeners) listener(data.state)
            } else if (data.kind === 'response' && Number.isSafeInteger(data.sequence) && isResponse(data.response)) {
                const operation = pending.get(data.sequence as number)
                if (!operation) return
                pending.delete(data.sequence as number)
                clearTimeout(operation.timer)
                operation.resolve(data.response)
            } else throw new Error('Invalid PostHog utility message')
        } catch (error) {
            close(error instanceof Error ? error : new Error('Invalid PostHog utility message'))
        }
    }
    port.on('message', message)
    try {
        port.postMessage(envelope({ kind: 'connect' }))
    } catch {
        close(new Error('PostHog parentPort unavailable'))
    }
    return {
        request: async (request: Request) => {
            await connected
            if (closed) throw new Error('PostHog utility connection closed')
            return new Promise<Response>((resolve, reject) => {
                // Stop waiting, but keep the authenticated channel: the owner may still finish this work
                // (for example a long multi-batch flush), and later requests must keep working.
                // Its late response is ignored because it is no longer pending.
                const timeout = setTimeout(() => {
                    if (pending.get(request.sequence)?.timer !== timeout) return
                    pending.delete(request.sequence)
                    reject(new Error('PostHog utility request timed out'))
                }, UTILITY_TIMEOUT_MS)
                pending.set(request.sequence, { resolve, reject, timer: timeout })
                try {
                    const value = envelope({ kind: 'request', token, request })
                    readEnvelope(value)
                    port.postMessage(value)
                } catch (error) {
                    pending.delete(request.sequence)
                    clearTimeout(timeout)
                    const failure = error instanceof Error ? error : new Error('PostHog utility request failed')
                    reject(failure)
                    close(failure)
                }
            })
        },
        subscribe: (callback) => {
            listeners.add(callback)
            return () => {
                listeners.delete(callback)
                close(new Error('PostHog utility client disposed'))
            }
        },
    }
}
