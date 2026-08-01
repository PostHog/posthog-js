import { Publisher } from '../src/pubsub'

describe('Publisher', () => {
    it('publishes payloads to registered listeners', () => {
        const publisher = new Publisher<{ value: number }>()
        const calls: Array<{ value: number }> = []

        publisher.listener((payload) => {
            calls.push(payload)
        })
        publisher.publish({ value: 1 })

        expect(calls).toEqual([{ value: 1 }])
    })

    it('unregisters a listener when its subscription is disposed', () => {
        const publisher = new Publisher<string>()
        const removedCalls: string[] = []
        const activeCalls: string[] = []

        const subscription = publisher.listener((payload) => {
            removedCalls.push(payload)
        })
        publisher.listener((payload) => {
            activeCalls.push(payload)
        })

        subscription.dispose()
        subscription.dispose()
        publisher.publish('payload')

        expect(removedCalls).toEqual([])
        expect(activeCalls).toEqual(['payload'])
    })

    it('drops all listeners when the publisher is disposed', () => {
        const publisher = new Publisher<string>()
        const firstCalls: string[] = []
        const secondCalls: string[] = []

        publisher.listener((payload) => {
            firstCalls.push(payload)
        })
        publisher.listener((payload) => {
            secondCalls.push(payload)
        })

        publisher.dispose()
        publisher.dispose()
        publisher.publish('payload')

        expect(firstCalls).toEqual([])
        expect(secondCalls).toEqual([])
    })

    it('continues after a listener throws', () => {
        const errors: unknown[] = []
        const calls: string[] = []
        const publisher = new Publisher<string>((error) => errors.push(error))
        const listenerError = new Error('listener failed')

        publisher.listener(() => {
            throw listenerError
        })
        publisher.listener((payload) => calls.push(payload))
        publisher.publish('payload')

        expect(errors).toEqual([listenerError])
        expect(calls).toEqual(['payload'])
    })

    it('does not retain listeners registered after disposal', () => {
        const publisher = new Publisher<string>()
        const calls: string[] = []

        publisher.dispose()
        publisher.listener((payload) => calls.push(payload))
        publisher.publish('payload')

        expect(calls).toEqual([])
    })

    it('does not call listeners registered during the current publish', () => {
        const publisher = new Publisher<string>()
        const calls: string[] = []

        publisher.listener((payload) => {
            calls.push(`first:${payload}`)
            publisher.listener((nextPayload) => {
                calls.push(`late:${nextPayload}`)
            })
        })

        publisher.publish('one')
        publisher.publish('two')

        expect(calls).toEqual(['first:one', 'first:two', 'late:two'])
    })

    it('does not call listeners disposed during the current publish', () => {
        const publisher = new Publisher<string>()
        const calls: string[] = []
        let disposeSecond = (): void => {}

        publisher.listener((payload) => {
            calls.push(`first:${payload}`)
            disposeSecond()
        })
        const secondSubscription = publisher.listener((payload) => {
            calls.push(`second:${payload}`)
        })
        disposeSecond = () => {
            secondSubscription.dispose()
        }

        publisher.publish('one')
        publisher.publish('two')

        expect(calls).toEqual(['first:one', 'first:two'])
    })
})
