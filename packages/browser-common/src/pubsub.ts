import type { Disposable } from './disposable'

/**
 * Call it with a handler to start listening; dispose the returned
 * {@link Disposable} to stop. There is one `Listener` per event type, so every
 * event carries its own payload type. The handler is called synchronously, and
 * stateful listeners may replay their current value during registration when
 * documented. The returned disposable unregisters it from future payloads.
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
    private _subscriptions: Array<[(payload: T) => void, boolean]> = []
    private _disposed = false

    private readonly _onError: ((error: unknown) => void) | undefined

    constructor(onError?: (error: unknown) => void) {
        this._onError = onError
    }

    /**
     * Register a handler for future payloads. The returned disposable
     * subscription unregisters this handler.
     */
    readonly listener: Listener<T> = (handler) => {
        if (this._disposed) {
            return { dispose() {} }
        }

        const subscription: [(payload: T) => void, boolean] = [handler, true]

        this._subscriptions.push(subscription)

        let active = true
        return {
            dispose: () => {
                if (!active) {
                    return
                }
                active = false
                subscription[1] = false

                const index = this._subscriptions.indexOf(subscription)
                if (index !== -1) {
                    this._subscriptions.splice(index, 1)
                }
            },
        }
    }

    /** Notify every currently registered listener with the provided payload. */
    publish(payload: T): void {
        const subscriptions = this._subscriptions.slice()

        for (const subscription of subscriptions) {
            if (!subscription[1]) {
                continue
            }

            try {
                subscription[0](payload)
            } catch (error) {
                if (!this._onError) {
                    throw error
                }
                this._onError(error)
            }
        }
    }

    /** Drop all registered listeners. Safe to call more than once. */
    dispose(): void {
        this._disposed = true
        this._subscriptions.forEach((subscription) => {
            subscription[1] = false
        })
        this._subscriptions = []
    }
}
