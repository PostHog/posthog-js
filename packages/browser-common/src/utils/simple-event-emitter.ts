import { logger } from './logger'

const callListener = (event: string, call: () => void): void => {
    try {
        call()
    } catch (error) {
        logger.critical(`A listener for "${event}" threw an error`, error)
    }
}

export class SimpleEventEmitter {
    private _events: { [key: string]: ((...args: any[]) => void)[] } = {}

    on(event: string, listener: (...args: any[]) => void): () => void {
        if (!this._events[event]) {
            this._events[event] = []
        }
        this._events[event].push(listener)

        return () => {
            this._events[event] = this._events[event]!.filter((x) => x !== listener)
        }
    }

    emit(event: string, payload: any): void {
        for (const listener of this._events[event] || []) {
            callListener(event, () => listener(payload))
        }
        for (const listener of this._events['*'] || []) {
            callListener(event, () => listener(event, payload))
        }
    }
}
