// Creates a buffer which has a max size, a flush interval, and a flush callback.

export interface EventBuffer<T> {
    push: (data: T) => void
    flush: () => void
}

export function createEventBuffer<T>(options: {
    maxDepth: number
    flushInterval: number
    callback: (data: T[]) => void
}): EventBuffer<T> {
    const { maxDepth, flushInterval, callback } = options
    let buffer: any[] = []
    let timeout: ReturnType<typeof setTimeout> | undefined

    const flush = () => {
        if (buffer.length > 0) {
            callback(buffer)
            buffer = []
        }
        if (timeout) {
            clearTimeout(timeout)
            timeout = undefined
        }
    }

    const push = (data: any) => {
        buffer.push(data)
        if (buffer.length >= maxDepth) {
            flush()
        } else if (!timeout) {
            timeout = setTimeout(flush, flushInterval)
        }
    }

    return {
        push,
        flush,
    }
}
