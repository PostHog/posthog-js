export class SimpleEventEmitter {
    private _events: { [key: string]: ((...args: any[]) => void)[] } = {}

    constructor() {
        this._events = {}
    }

    on(event: string, listener: (...args: any[]) => void): () => void {
        if (!this._events[event]) {
            this._events[event] = []
        }
        this._events[event].push(listener)

        return () => {
            this._events[event] = this._events[event].filter((x) => x !== listener)
        }
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
