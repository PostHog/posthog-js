export function makeMouseEvent(partialEvent: Partial<MouseEvent>): MouseEvent {
    return { type: 'click', timeStamp: Date.now(), ...partialEvent } as unknown as MouseEvent
}
