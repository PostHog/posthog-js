import { SimpleEventEmitter } from '../src/utils/simple-event-emitter'

describe('SimpleEventEmitter', () => {
    it('clears listeners for one event', () => {
        const emitter = new SimpleEventEmitter()
        const first = jest.fn()
        const second = jest.fn()
        const unsubscribe = emitter.on('first', first)
        emitter.on('second', second)

        emitter.clear('first')
        emitter.emit('first', 'ignored')
        emitter.emit('second', 'received')

        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledWith('received')
        expect(unsubscribe).not.toThrow()
    })
})
