import { EmitterEvent } from './types'

export class SimpleEventEmitter {
    events: { [key: string]: ((...args: any[]) => void)[] } = {}

    constructor() {
        this.events = {}
    }

    on(event: EmitterEvent, listener: (...args: any[]) => void): () => void {
        if (!this.events[event]) {
            this.events[event] = []
        }
        this.events[event].push(listener)

        return () => {
            this.events[event] = this.events[event].filter((x) => x !== listener)
        }
    }

    emit(event: EmitterEvent, ...payload: any[]): void {
        for (const listener of this.events[event] || []) {
            listener(...payload)
        }
        for (const listener of this.events['*'] || []) {
            listener(event, ...payload)
        }
    }
}
