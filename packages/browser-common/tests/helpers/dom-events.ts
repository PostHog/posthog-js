export function makeMouseEvent(partialEvent: Partial<MouseEvent>) {
    return { type: 'click', timeStamp: Date.now(), ...partialEvent } as unknown as MouseEvent
}

export function makeCopyEvent(partialEvent: Partial<ClipboardEvent>) {
    return { type: 'copy', ...partialEvent } as unknown as ClipboardEvent
}

export function makeCutEvent(partialEvent: Partial<ClipboardEvent>) {
    return { type: 'cut', ...partialEvent } as unknown as ClipboardEvent
}
