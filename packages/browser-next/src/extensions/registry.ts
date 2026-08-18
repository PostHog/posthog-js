import type { Client, Disposable, Extension } from '@posthog/browser-common'

interface ExtensionRecord {
    readonly extension: Extension
    disposed: boolean
    ready: boolean
}

export class ExtensionRegistry {
    private readonly _records = new Map<string, ExtensionRecord>()
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
        try {
            await extension.setup(this._createClient(name))
            if (this._disposed || record.disposed) {
                throw new Error('The extension registry was disposed during setup')
            }
            record.ready = true
        } catch (error) {
            if (this._records.get(name) === record) {
                this._records.delete(name)
            }
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
                if (active) {
                    active = false
                    await this._remove(name)
                }
            },
        }
    }

    async dispose(): Promise<void> {
        if (this._disposed) {
            return
        }
        this._disposed = true
        const records = Array.from(this._records.values()).reverse()
        this._records.clear()
        for (const record of records) {
            try {
                await this._disposeRecord(record)
            } catch (error) {
                this._logger.error(`Extension "${record.extension.name}" cleanup failed`, error)
            }
        }
    }

    private async _remove(name: string): Promise<void> {
        const record = this._records.get(name)
        if (record) {
            this._records.delete(name)
            await this._disposeRecord(record)
        }
    }

    private async _disposeRecord(record: ExtensionRecord): Promise<void> {
        if (!record.disposed) {
            record.disposed = true
            await record.extension.dispose?.()
        }
    }
}
