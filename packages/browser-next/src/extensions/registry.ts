import type { Client, Disposable, Extension } from '@posthog/browser-common'

interface ExtensionRecord {
    readonly extension: Extension
    disposed: boolean
    ready: boolean
}

export class ExtensionRegistry {
    private readonly _records = new Map<string, ExtensionRecord>()
    private readonly _order: string[] = []
    private _disposed = false

    constructor(
        private readonly _createClient: (extensionName: string) => Client,
        private readonly _logger: Client['logger']
    ) {}

    get<T extends Extension = Extension>(name: string): T | undefined {
        const record = this._records.get(name)
        return record?.ready ? (record.extension as T) : undefined
    }

    async install(extension: Extension): Promise<Disposable> {
        if (this._disposed) {
            throw new Error('The extension registry is disposed')
        }

        const { name } = extension
        if (!name || this._records.has(name)) {
            throw new Error(`An extension named "${name}" is already installed`)
        }

        const record: ExtensionRecord = { extension, disposed: false, ready: false }
        this._records.set(name, record)
        this._order.push(name)

        try {
            await extension.setup(this._createClient(name))
            if (this._disposed || record.disposed) {
                throw new Error('The extension registry was disposed during setup')
            }
            record.ready = true
        } catch (error) {
            this._forget(name, record)
            try {
                await this._disposeRecord(record)
            } catch (disposeError) {
                this._logger.error('Extension cleanup failed after setup failed', disposeError)
            }
            throw error
        }

        let active = true
        return {
            dispose: async (): Promise<void> => {
                if (!active) {
                    return
                }
                active = false
                await this._remove(name)
            },
        }
    }

    async load(loader: () => Promise<Extension>): Promise<Disposable> {
        return this.install(await loader())
    }

    async dispose(): Promise<void> {
        if (this._disposed) {
            return
        }
        this._disposed = true

        const names = [...this._order].reverse()
        for (const name of names) {
            try {
                await this._remove(name)
            } catch (error) {
                this._logger.error(`Extension "${name}" cleanup failed`, error)
            }
        }
    }

    private _forget(name: string, record: ExtensionRecord): void {
        if (this._records.get(name) === record) {
            this._records.delete(name)
        }
        const index = this._order.indexOf(name)
        if (index !== -1) {
            this._order.splice(index, 1)
        }
    }

    private async _remove(name: string): Promise<void> {
        const record = this._records.get(name)
        if (!record) {
            return
        }

        this._forget(name, record)
        await this._disposeRecord(record)
    }

    private async _disposeRecord(record: ExtensionRecord): Promise<void> {
        if (record.disposed) {
            return
        }
        record.disposed = true
        await record.extension.dispose?.()
    }
}
