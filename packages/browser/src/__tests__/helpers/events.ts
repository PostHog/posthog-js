export const triggerMouseEvent = function (node: Node, eventType: string) {
    node.dispatchEvent(
        new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
        })
    )
}

export const simulateClick = function (el: Node) {
    triggerMouseEvent(el, 'click')
}

export function makeMouseEvent(partialEvent: Partial<MouseEvent>) {
    return { type: 'click', ...partialEvent } as unknown as MouseEvent
}

export function makeCopyEvent(partialEvent: Partial<ClipboardEvent>) {
    return { type: 'copy', ...partialEvent } as unknown as ClipboardEvent
}

export function makeCutEvent(partialEvent: Partial<ClipboardEvent>) {
    return { type: 'cut', ...partialEvent } as unknown as ClipboardEvent
}
