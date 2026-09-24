import type { Client, Extension } from '@posthog/browser-common'

type ExtensionRecord = [extension: Extension, disposed: boolean, names: string[]]

export class ExtensionRegistry {
    private readonly _records = new Map<string, ExtensionRecord>()
    private readonly _extensions = new Map<string, Extension>()
    private _disposed = false

    private readonly _createClient: (extensionName: string) => Client
    private readonly _logger: Client['logger']

    constructor(createClient: (extensionName: string) => Client, logger: Client['logger']) {
        this._createClient = createClient
        this._logger = logger
    }

    get<T extends Extension = Extension>(name: string): T | undefined {
        return this._extensions.get(name) as T | undefined
    }

    async install(extension: Extension): Promise<void> {
        if (this._disposed) {
            throw new Error('The extension registry is disposed')
        }
        const { name } = extension
        const bindings: Array<[string, Extension]> = [[name, extension], ...Object.entries(extension.bindings ?? {})]
        const names = new Set<string>()
        for (const [key] of bindings) {
            if (!key || names.has(key) || this._extensions.has(key)) {
                throw new Error(`An extension named "${key}" is already installed or the name is invalid`)
            }
            names.add(key)
        }

        const record: ExtensionRecord = [extension, false, [...names]]
        this._records.set(name, record)
        for (const [key, target] of bindings) this._extensions.set(key, target)
        try {
            await extension.setup(this._createClient(name))
            if (this._disposed || record[1]) {
                throw new Error('The extension registry was disposed during setup')
            }
        } catch (error) {
            if (this._records.get(name) === record) {
                this._removeRecord(record)
            }
            try {
                await this._disposeRecord(record)
            } catch (disposeError) {
                this._logger.error('Extension cleanup failed after setup failed', disposeError)
            }
            throw error
        }
    }

    async rollback(extension: Extension): Promise<void> {
        const record = this._records.get(extension.name)
        if (record?.[0] === extension) {
            this._removeRecord(record)
            await this._disposeRecord(record)
        }
    }

    async flush(reason: 'flush' | 'shutdown' = 'flush'): Promise<void> {
        await Promise.all(
            Array.from(this._records.values()).map(async ([extension]) => {
                try {
                    await extension.flush?.(reason)
                } catch (error) {
                    this._logger.error(`Extension "${extension.name}" flush failed`, error)
                }
            })
        )
    }

    async dispose(): Promise<void> {
        if (this._disposed) {
            return
        }
        this._disposed = true
        const records = Array.from(this._records.values()).reverse()
        this._records.clear()
        this._extensions.clear()
        await Promise.all(
            records.map(async (record) => {
                try {
                    await this._disposeRecord(record)
                } catch (error) {
                    this._logger.error(`Extension "${record[0].name}" cleanup failed`, error)
                }
            })
        )
    }

    private _removeRecord(record: ExtensionRecord): void {
        this._records.delete(record[0].name)
        for (const name of record[2]) this._extensions.delete(name)
    }

    private async _disposeRecord(record: ExtensionRecord): Promise<void> {
        if (!record[1]) {
            record[1] = true
            await record[0].dispose?.()
        }
    }
}
