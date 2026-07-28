import { isFunction, type Logger } from '@posthog/core'

import type { Client } from './client'
import type { Disposable } from './disposable'
import type { Extension } from './extension'

/** Shared setup and lifecycle registry for browser extension hosts. */
export class ExtensionRuntime implements Disposable {
    private readonly _extensions = new Map<string, Extension>()
    private _disposed = false

    constructor(
        private readonly _logger: Logger,
        private readonly _client: Client
    ) {}

    /** Reserves an extension name and sets it up with the host client adapter. */
    async add(extension: Extension): Promise<void> {
        if (this._disposed) {
            throw new Error('Cannot add an extension to a disposed ExtensionRuntime')
        }
        if (this._extensions.has(extension.name)) {
            throw new Error(`Browser extension "${extension.name}" is already registered`)
        }

        this._extensions.set(extension.name, extension)

        try {
            const setup = extension.setup(this._client)
            if (setup) {
                await setup
            }
        } catch (error) {
            const active = this._extensions.get(extension.name) === extension
            if (active) {
                this._extensions.delete(extension.name)
            }
            this._logger.error(`Failed to set up browser extension "${extension.name}"`, error)
            if (active) {
                this._disposeExtension(extension)
            }
        }
    }

    /** Releases every registered extension once in reverse registration order without waiting for pending setup. */
    dispose(): void {
        if (this._disposed) {
            return
        }
        this._disposed = true

        const extensions = Array.from(this._extensions.values()).reverse()
        this._extensions.clear()
        for (const extension of extensions) {
            this._disposeExtension(extension)
        }
    }

    private _disposeExtension(extension: Extension): void {
        try {
            const result = extension.dispose?.() as unknown
            if (result && isFunction((result as PromiseLike<void>).then)) {
                void (result as PromiseLike<void>).then(undefined, (error) => {
                    this._logger.error(`Failed to dispose browser extension "${extension.name}"`, error)
                })
            }
        } catch (error) {
            this._logger.error(`Failed to dispose browser extension "${extension.name}"`, error)
        }
    }
}
