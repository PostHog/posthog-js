export class SimpleEventEmitter {
    private _events: { [key: string]: ((...args: any[]) => void)[] } = {}

    on(event: string, listener: (...args: any[]) => void): () => void {
        if (!this._events[event]) {
            this._events[event] = []
        }
        this._events[event].push(listener)

        return () => {
            const listeners = this._events[event]
            if (listeners) {
                this._events[event] = listeners.filter((x) => x !== listener)
            }
        }
    }

    clear(event: string): void {
        delete this._events[event]
    }

    emit(event: string, payload: any): void {
        for (const listener of this._events[event] || []) {
            listener(payload)
        }
        for (const listener of this._events['*'] || []) {
            listener(event, payload)
        }
    }
}
