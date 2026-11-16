import type { Client, Extension } from '@posthog/browser-common'

export type ExtensionLoader<Host = Client> = (host: Host) => Extension<Host> | Promise<Extension<Host>>
type Resolver<Host> = (name: string) => Promise<Extension<Host> | undefined>

export interface AutomaticExtension<Host = Client> {
    name: string
    activate(host: Host, acquire: () => Promise<Extension<Host> | undefined>): void | Promise<unknown>
}

interface ExtensionRecord<Host> {
    extension: Extension<Host>
    disposed: boolean
    sharedNames: string[]
    ready: Promise<Extension<Host> | undefined>
    finish(extension: Extension<Host> | undefined): void
}

interface Installation<Host> {
    name: string
    bindings: Array<[string, Extension]>
    record: ExtensionRecord<Host>
}

/** Owns product acquisition, installed views and one lifecycle per configured owner. */
export class ExtensionRegistry<Host = Client> {
    private readonly _records = new Map<string, ExtensionRecord<Host>>()
    private readonly _retired = new WeakSet<Extension<Host>>()
    private readonly _extensions = new Map<string, Extension<Host>>()
    private readonly _shared = new Map<string, Extension>()
    private readonly _sharedReservations = new Set<string>()
    private readonly _pending = new Map<string, Promise<Extension<Host> | undefined>>()
    private readonly _dependencies = new Map<string, Set<string>>()
    private readonly _views = new Set<object>()
    private readonly _clients = new Map<string, Host>()
    private readonly _publications = new WeakMap<object, Map<string, () => Extension<Host> | undefined>>()
    private _disposed = false

    constructor(
        private readonly _createClient: (extensionName: string, resolve: Resolver<Host>) => Host,
        private readonly _logger: Client['logger'],
        private readonly _loaders: Readonly<Record<string, ExtensionLoader<Host>>> = {},
        private readonly _setup: (extension: Extension<Host>, host: Host) => void | Promise<void> = (extension, host) =>
            extension.setup(host),
        private readonly _canInstall: () => boolean = () => true
    ) {}

    expose(target: object): void {
        if (this._disposed || this._views.has(target)) return
        const publications = new Map<string, () => Extension<Host> | undefined>()
        this._publications.set(target, publications)
        try {
            for (const extension of this._extensions.values()) this._publish(target, extension.name)
        } catch (error) {
            for (const name of publications.keys()) this._removePublication(target, name)
            this._publications.delete(target)
            throw error
        }
        this._views.add(target)
    }

    get<T extends Extension<Host> = Extension<Host>>(name: string): T | undefined {
        return this._extensions.get(name) as T | undefined
    }

    getShared<T extends Extension = Extension>(name: string): T | undefined {
        return this._shared.get(name) as T | undefined
    }

    resolve(name: string): Promise<Extension<Host> | undefined> {
        if (this._disposed || !this._canInstall()) return Promise.resolve(undefined)
        const existing = this._existingResolution(name)
        if (existing) return existing
        const load = Object.hasOwn(this._loaders, name) ? this._loaders[name] : undefined
        if (!load) return Promise.resolve(undefined)
        // Record acquisition before calling user code, including synchronous loaders.
        const loading = Promise.resolve().then(() => this._load(name, load))
        this._pending.set(name, loading)
        void loading.then(() => {
            if (this._pending.get(name) === loading) this._pending.delete(name)
        })
        return loading
    }

    async activate({ name, activate }: AutomaticExtension<Host>): Promise<void> {
        if (this._disposed || !this._canInstall() || this.get(name)) return
        try {
            const host = this._client(name)
            this._assertNameAvailable(name)
            await activate(host, () => this.resolve(name))
        } catch (error) {
            this._logger.error(`Extension "${name}" activation failed`, error)
        }
    }

    async install(extension: Extension<Host>): Promise<void> {
        const installation = this._reserveInstallation(extension)
        const { name, record } = installation
        try {
            const host = this._client(name)
            this._assertNameAvailable(name)
            await this._setup(extension, host)
            this._publishInstallation(installation)
        } catch (error) {
            this._removeRecord(record)
            record.finish(undefined)
            try {
                await this._disposeRecord(record)
            } catch (disposeError) {
                this._logger.error('Extension cleanup failed after setup failed', disposeError)
            }
            throw error
        } finally {
            this._dependencies.delete(name)
        }
    }

    private _existingResolution(name: string): Promise<Extension<Host> | undefined> | undefined {
        const installed = this.get(name)
        if (installed) return Promise.resolve(installed)
        return this._pending.get(name) ?? this._records.get(name)?.ready
    }

    private _reserveInstallation(extension: Extension<Host>): Installation<Host> {
        if (this._disposed) throw new Error('The extension registry is disposed')
        if (this._retired.has(extension)) throw new Error('The extension instance has already been disposed')
        const { name } = extension
        if (!name || this._records.has(name))
            throw new Error(`An extension named "${name}" is already installed or the name is invalid`)
        this._assertNameAvailable(name)
        const bindings = this._bindingEntries(extension)
        let finish!: ExtensionRecord<Host>['finish']
        const record: ExtensionRecord<Host> = {
            extension,
            disposed: false,
            sharedNames: bindings.map(([key]) => key),
            ready: new Promise((resolve) => {
                finish = resolve
            }),
            finish: (value) => finish(value),
        }
        this._records.set(name, record)
        for (const [key] of bindings) this._sharedReservations.add(key)
        return { name, bindings, record }
    }

    private _bindingEntries(extension: Extension<Host>): Array<[string, Extension]> {
        const bindings = Object.entries(extension.bindings ?? {})
        for (const [key] of bindings) {
            if (!key || this._sharedReservations.has(key))
                throw new Error(`A shared extension named "${key}" is already installed or the name is invalid`)
        }
        return bindings
    }

    private _publishInstallation({ name, bindings, record }: Installation<Host>): void {
        if (this._disposed || record.disposed || !this._canInstall()) {
            throw new Error('Extension installation stopped during setup')
        }
        this._extensions.set(name, record.extension)
        for (const view of this._views) this._publish(view, name)
        for (const [key, target] of bindings) this._shared.set(key, target)
        record.finish(record.extension)
    }

    async rollback(extension: Extension<Host>): Promise<void> {
        const record = this._records.get(extension.name)
        if (record?.extension === extension) {
            this._removeRecord(record)
            record.finish(undefined)
            await this._disposeRecord(record)
        }
    }

    async flush(reason: 'flush' | 'shutdown' = 'flush'): Promise<void> {
        await Promise.all(
            Array.from(this._extensions.values()).map(async (extension) => {
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
        const records = Array.from(this._records.values()).reverse()
        this._records.clear()
        for (const name of this._extensions.keys()) this._unpublish(name)
        this._extensions.clear()
        this._shared.clear()
        this._sharedReservations.clear()
        this._dependencies.clear()
        this._views.clear()
        this._clients.clear()
        await Promise.all(
            records.map(async (record) => {
                record.finish(undefined)
                try {
                    await this._disposeRecord(record)
                } catch (error) {
                    this._logger.error(`Extension "${record.extension.name}" cleanup failed`, error)
                }
            })
        )
    }

    private _client(name: string): Host {
        const existing = this._clients.get(name)
        if (existing !== undefined) return existing
        const host = this._createClient(name, (target) => this._resolveDependency(name, target))
        if (!this._disposed) this._clients.set(name, host)
        return host
    }

    private async _load(name: string, load: ExtensionLoader<Host>): Promise<Extension<Host> | undefined> {
        try {
            const host = this._client(name)
            this._assertNameAvailable(name)
            const extension = await load(host)
            if (this._disposed || extension.name !== name) {
                await extension.dispose?.()
                if (!this._disposed) throw new Error(`Loader for "${name}" returned extension "${extension.name}"`)
                return undefined
            }
            await this.install(extension)
            return this.get(name)
        } catch (error) {
            this._logger.error(`Extension "${name}" loading failed`, error)
            return undefined
        } finally {
            this._dependencies.delete(name)
        }
    }

    private _resolveDependency(owner: string, target: string): Promise<Extension<Host> | undefined> {
        if (this.get(owner) || this.get(target)) return this.resolve(target)
        if (owner === target || this._reaches(target, owner, new Set())) {
            this._logger.error(
                `Circular extension dependency: "${owner}" -> "${target}"`,
                new Error('Circular extension dependency')
            )
            return Promise.resolve(undefined)
        }
        let dependencies = this._dependencies.get(owner)
        if (!dependencies) this._dependencies.set(owner, (dependencies = new Set()))
        dependencies.add(target)
        return this.resolve(target)
    }

    private _reaches(from: string, target: string, visited: Set<string>): boolean {
        if (from === target) return true
        if (visited.has(from)) return false
        visited.add(from)
        for (const next of this._dependencies.get(from) ?? []) {
            if (this._reaches(next, target, visited)) return true
        }
        return false
    }

    private _removeRecord(record: ExtensionRecord<Host>): void {
        const name = record.extension.name
        if (this._records.get(name) !== record) return
        this._records.delete(name)
        this._extensions.delete(name)
        this._unpublish(name)
        for (const key of record.sharedNames) {
            this._shared.delete(key)
            this._sharedReservations.delete(key)
        }
    }

    private _assertNameAvailable(name: string): void {
        for (const view of this._views) {
            if (name in view) throw new Error(`Extension name "${name}" conflicts with a client capability`)
        }
    }

    private _publish(view: object, name: string): void {
        if (name in view) throw new Error(`Extension name "${name}" conflicts with a client capability`)
        const read = () => this.get(name)
        Object.defineProperty(view, name, { enumerable: true, configurable: true, get: read })
        this._publications.get(view)?.set(name, read)
    }

    private _removePublication(view: object, name: string): void {
        const read = this._publications.get(view)?.get(name)
        if (read && Object.getOwnPropertyDescriptor(view, name)?.get === read) Reflect.deleteProperty(view, name)
        this._publications.get(view)?.delete(name)
    }

    private _unpublish(name: string): void {
        for (const view of this._views) this._removePublication(view, name)
    }

    private async _disposeRecord(record: ExtensionRecord<Host>): Promise<void> {
        if (!record.disposed) {
            record.disposed = true
            this._retired.add(record.extension)
            await record.extension.dispose?.()
        }
    }
}
