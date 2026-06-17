import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Publisher } from '../pubsub.ts'

describe('Publisher', () => {
    it('publishes payloads to registered listeners', () => {
        const publisher = new Publisher<{ value: number }>()
        const calls: Array<{ value: number }> = []

        publisher.listener((payload) => {
            calls.push(payload)
        })
        publisher.publish({ value: 1 })

        assert.deepEqual(calls, [{ value: 1 }])
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

        assert.deepEqual(removedCalls, [])
        assert.deepEqual(activeCalls, ['payload'])
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

        assert.deepEqual(firstCalls, [])
        assert.deepEqual(secondCalls, [])
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

        assert.deepEqual(calls, ['first:one', 'first:two', 'late:two'])
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

        assert.deepEqual(calls, ['first:one', 'first:two'])
    })
})
