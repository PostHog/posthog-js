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
                const idx = listeners.indexOf(listener)
                if (idx !== -1) {
                    listeners.splice(idx, 1)
                }
            }
        }
    }

    emit(event: string, payload: any): void {
        const listeners = this._events[event]
        if (listeners) {
            for (let i = 0; i < listeners.length; i++) {
                listeners[i](payload)
            }
        }
        const wildcardListeners = this._events['*']
        if (wildcardListeners) {
            for (let i = 0; i < wildcardListeners.length; i++) {
                wildcardListeners[i](event, payload)
            }
        }
    }
}
