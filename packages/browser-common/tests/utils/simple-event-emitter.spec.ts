import { SimpleEventEmitter } from '../../src/utils/simple-event-emitter'

describe('SimpleEventEmitter', () => {
    it.each(['__proto__', 'constructor', 'toString'])(
        'supports event names that exist on Object.prototype: %s',
        (event) => {
            const emitter = new SimpleEventEmitter()
            const calls: unknown[] = []

            emitter.on(event, (payload) => calls.push(payload))
            emitter.emit(event, 'first')

            expect(calls).toEqual(['first'])
        }
    )
})
