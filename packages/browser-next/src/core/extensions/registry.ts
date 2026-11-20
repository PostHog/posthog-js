import type { Client, Extension } from '@posthog/browser-common'

export type ExtensionLoader<Host> = () => Extension<Host> | Promise<Extension<Host>>

export interface AutomaticExtension<Host> {
    name: string
    activate(host: Host, acquire: () => Promise<Extension<Host> | undefined>): void | Promise<unknown>
}

/**
 * Installs extensions on the one client, publishes each as a client property, and owns their lifecycle.
 * Extension names and their bindings share one lookup namespace.
 */
export class ExtensionRegistry<Host extends object> {
    private readonly _installed = new Map<string, Extension<Host>>()
    private readonly _settingUp = new Set<Extension<Host>>()
    private readonly _lookup = new Map<string, object>()
    private readonly _reserved = new Set<string>()
    private readonly _pending = new Map<string, Promise<Extension<Host> | undefined>>()
    private readonly _retired = new WeakSet<object>()
    private _disposed = false

    constructor(
        private readonly _host: Host,
        private readonly _logger: Client['logger'],
        private readonly _loaders: Readonly<Record<string, ExtensionLoader<Host>>> = {},
        private readonly _canInstall: () => boolean = () => true
    ) {}

    get<T extends Extension = Extension>(name: string): T | undefined {
        return this._lookup.get(name) as T | undefined
    }

    resolve(name: string): Promise<Extension<Host> | undefined> {
        if (this._disposed || !this._canInstall()) return Promise.resolve(undefined)
        const installed = this._installed.get(name)
        if (installed) return Promise.resolve(installed)
        const pending = this._pending.get(name)
        if (pending) return pending
        const load = Object.hasOwn(this._loaders, name) ? this._loaders[name] : undefined
        if (!load) return Promise.resolve(undefined)
        const loading = Promise.resolve()
            .then(load)
            .then(async (extension) => {
                if (this._disposed || !this._canInstall()) {
                    await extension.dispose?.()
                    return undefined
                }
                if (extension.name !== name) {
                    await extension.dispose?.()
                    throw new Error(`Loader for "${name}" returned extension "${extension.name}"`)
                }
                await this.install(extension)
                return this._installed.get(name)
            })
            .catch((error: unknown) => {
                this._logger.error(`Extension "${name}" loading failed`, error)
                return undefined
            })
            .finally(() => this._pending.delete(name))
        this._pending.set(name, loading)
        return loading
    }

    async activate({ name, activate }: AutomaticExtension<Host>): Promise<void> {
        if (this._disposed || !this._canInstall() || this._installed.has(name)) return
        try {
            await activate(this._host, () => this.resolve(name))
        } catch (error) {
            this._logger.error(`Extension "${name}" activation failed`, error)
        }
    }

    async install(extension: Extension<Host>): Promise<void> {
        if (this._disposed) throw new Error('The extension registry is disposed')
        if (this._retired.has(extension)) throw new Error('The extension instance has already been disposed')
        const names = [extension.name, ...Object.keys(extension.bindings ?? {})]
        // A binding named after its own extension would make `getExtension(name)` disagree with `posthog[name]`.
        if (new Set(names).size !== names.length) {
            throw new Error(`Extension name "${extension.name}" is invalid or already in use`)
        }
        for (const key of names) {
            if (!key || this._lookup.has(key) || this._reserved.has(key) || key in this._host) {
                throw new Error(`Extension name "${key}" is invalid or already in use`)
            }
        }
        for (const key of names) this._reserved.add(key)
        this._settingUp.add(extension)
        try {
            await extension.setup(this._host)
            if (this._disposed || !this._canInstall()) throw new Error('Extension installation stopped during setup')
        } catch (error) {
            // Registry disposal may already have cleaned up an extension that was mid-setup.
            if (!this._retired.has(extension)) {
                this._retired.add(extension)
                try {
                    await extension.dispose?.()
                } catch (disposeError) {
                    this._logger.error('Extension cleanup failed after setup failed', disposeError)
                }
            }
            throw error
        } finally {
            this._settingUp.delete(extension)
            for (const key of names) this._reserved.delete(key)
        }
        const { name } = extension
        this._installed.set(name, extension)
        this._lookup.set(name, extension)
        for (const [key, target] of Object.entries(extension.bindings ?? {})) this._lookup.set(key, target)
        Object.defineProperty(this._host, name, {
            enumerable: true,
            configurable: true,
            get: () => this._installed.get(name),
        })
    }

    async flush(reason: 'flush' | 'shutdown' = 'flush'): Promise<void> {
        await Promise.all(
            Array.from(this._installed.values()).map(async (extension) => {
                try {
                    await extension.flush?.(reason)
                } catch (error) {
                    this._logger.error(`Extension "${extension.name}" flush failed`, error)
                }
            })
        )
    }

    async dispose(): Promise<void> {
        if (this._disposed) return
        this._disposed = true
        const installed = Array.from(this._installed.values()).reverse()
        for (const { name } of installed) Reflect.deleteProperty(this._host, name)
        this._installed.clear()
        this._lookup.clear()
        // Extensions still in setup may already hold resources, so clean them up now rather than when setup settles.
        const extensions = [...installed, ...this._settingUp]
        // Dispose concurrently so one stuck extension cannot block the others' cleanup.
        await Promise.all(
            extensions.map(async (extension) => {
                if (this._retired.has(extension)) return
                this._retired.add(extension)
                try {
                    await extension.dispose?.()
                } catch (error) {
                    this._logger.error(`Extension "${extension.name}" cleanup failed`, error)
                }
            })
        )
    }
}
