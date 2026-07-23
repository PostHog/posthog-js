import { isFunction, type Logger } from '@posthog/core'

import type { Client } from './client'
import type { Disposable } from './disposable'
import type { Extension } from './extension'
import type { ExtensionToken } from './token'

interface RegisteredExtension {
    extension: Extension
    setupPromise: Promise<void>
    disposalPromise?: Promise<void>
}

/**
 * Shared lifecycle and capability registry for browser extension hosts.
 *
 * Hosts provide the concrete Client adapter while this runtime coordinates
 * names, capability readiness, setup failures, and reverse-order teardown.
 */
export class ExtensionRuntime implements Disposable {
    private readonly _extensions = new Map<string, RegisteredExtension>()
    private readonly _registrationOrder: RegisteredExtension[] = []
    private readonly _providerReservations = new Map<string, RegisteredExtension>()
    private readonly _providers = new Map<string, unknown>()
    private _disposePromise: Promise<void> | undefined

    constructor(private readonly _logger: Logger) {}

    /**
     * Sets up an extension and publishes its capabilities once setup succeeds.
     * Names and tokens remain reserved while asynchronous setup is pending.
     */
    add(extension: Extension, client: Client): Promise<void> {
        if (this._disposePromise) {
            throw new Error('Cannot add an extension to a disposed ExtensionRuntime')
        }
        if (this._extensions.has(extension.name)) {
            throw new Error(`Browser extension "${extension.name}" is already registered`)
        }

        for (const token of extension.provides ?? []) {
            if (this._providerReservations.has(token)) {
                throw new Error(`Browser extension token "${token}" is already registered`)
            }
        }

        // eslint-disable-next-line compat/compat -- Extension setup is intentionally awaitable.
        const registered = { extension, setupPromise: Promise.resolve() } satisfies RegisteredExtension
        this._extensions.set(extension.name, registered)
        this._registrationOrder.push(registered)
        for (const token of extension.provides ?? []) {
            this._providerReservations.set(token, registered)
        }

        let setupResult: void | Promise<void>
        try {
            setupResult = extension.setup(client)
        } catch (error) {
            registered.setupPromise = this._handleSetupFailure(registered, error)
            return registered.setupPromise
        }

        if (setupResult && isFunction(setupResult.then)) {
            registered.setupPromise = setupResult
                .then(() => this._publishRegistration(registered))
                .catch((error) => this._handleSetupFailure(registered, error))
        } else {
            this._publishRegistration(registered)
        }
        return registered.setupPromise
    }

    /** Resolves a capability only after its provider has completed setup. */
    getExtension<T>(token: ExtensionToken<T>): T | undefined {
        return this._providers.get(token) as T | undefined
    }

    /** Disposes every registered extension once, in reverse registration order. */
    dispose(): Promise<void> {
        if (!this._disposePromise) {
            this._disposePromise = this._disposeAll()
        }
        return this._disposePromise
    }

    private async _disposeAll(): Promise<void> {
        for (const registered of this._registrationOrder.slice().reverse()) {
            await registered.setupPromise
            await this._disposeRegistration(registered)
        }

        this._extensions.clear()
        this._registrationOrder.length = 0
        this._providerReservations.clear()
        this._providers.clear()
    }

    private async _handleSetupFailure(registered: RegisteredExtension, error: unknown): Promise<void> {
        this._removeRegistration(registered)
        this._logger.error(`Failed to set up browser extension "${registered.extension.name}"`, error)
        if (this._disposePromise) {
            return
        }
        await this._disposeRegistration(registered)
        const index = this._registrationOrder.indexOf(registered)
        if (index !== -1) {
            this._registrationOrder.splice(index, 1)
        }
    }

    private _disposeRegistration(registered: RegisteredExtension): Promise<void> {
        if (!registered.disposalPromise) {
            registered.disposalPromise = Promise.resolve()
                .then(() => registered.extension.dispose())
                .catch((error) => {
                    this._logger.error(`Failed to dispose browser extension "${registered.extension.name}"`, error)
                })
        }
        return registered.disposalPromise
    }

    private _removeRegistration(registered: RegisteredExtension): void {
        if (this._extensions.get(registered.extension.name) === registered) {
            this._extensions.delete(registered.extension.name)
        }
        for (const token of registered.extension.provides ?? []) {
            if (this._providerReservations.get(token) === registered) {
                this._providerReservations.delete(token)
            }
            if (this._providers.get(token) === registered.extension) {
                this._providers.delete(token)
            }
        }
    }

    private _publishRegistration(registered: RegisteredExtension): void {
        if (this._disposePromise || this._extensions.get(registered.extension.name) !== registered) {
            return
        }
        for (const token of registered.extension.provides ?? []) {
            this._providers.set(token, registered.extension)
        }
    }
}
