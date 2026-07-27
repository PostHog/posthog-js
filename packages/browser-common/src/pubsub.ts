import { createDisposable, type Disposable } from './disposable'

/**
 * Call it with a handler to start listening; dispose the returned
 * {@link Disposable} to stop. There is one `Listener` per event type, so every
 * event carries its own payload type. The handler is called synchronously for
 * each future payload, and the returned disposable unregisters it.
 */
export type Listener<T> = (handler: (payload: T) => void) => Disposable

/**
 * Publish/subscribe helper for client events exposed to extensions. A client
 * owns the publisher, calls {@link Publisher.publish} to fire payloads, and
 * exposes only {@link Publisher.listener} to extensions so they can subscribe
 * without gaining publish access. Calling {@link Publisher.dispose} drops all
 * listeners.
 */
export class Publisher<T> implements Disposable {
    /** Subscriptions currently registered with this publisher. */
    private _subscriptions: Array<{ handler: (payload: T) => void; isActive: boolean }> = []

    /**
     * Register a handler for future payloads. The returned disposable
     * subscription unregisters this handler.
     */
    readonly listener: Listener<T> = (handler) => {
        const subscription = { handler, isActive: true }

        this._subscriptions.push(subscription)

        return createDisposable(() => {
            subscription.isActive = false

            const index = this._subscriptions.indexOf(subscription)
            if (index !== -1) {
                this._subscriptions.splice(index, 1)
            }
        })
    }

    /** Notify every currently registered listener with the provided payload. */
    publish(payload: T): void {
        const subscriptions = this._subscriptions.slice()

        subscriptions.forEach((subscription) => {
            if (subscription.isActive) {
                subscription.handler(payload)
            }
        })
    }

    /** Drop all registered listeners. Safe to call more than once. */
    dispose(): void {
        this._subscriptions.forEach((subscription) => {
            subscription.isActive = false
        })
        this._subscriptions = []
    }
}
