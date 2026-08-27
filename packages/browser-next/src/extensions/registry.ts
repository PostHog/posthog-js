import type { Client, Extension } from '@posthog/browser-common'

type ExtensionRecord = [extension: Extension, disposed: boolean]

export class ExtensionRegistry {
    private readonly _records = new Map<string, ExtensionRecord>()
    private _disposed = false

    private readonly _createClient: (extensionName: string) => Client
    private readonly _logger: Client['logger']

    constructor(createClient: (extensionName: string) => Client, logger: Client['logger']) {
        this._createClient = createClient
        this._logger = logger
    }

    get<T extends Extension = Extension>(name: string): T | undefined {
        return this._records.get(name)?.[0] as T | undefined
    }

    async install(extension: Extension): Promise<void> {
        if (this._disposed) {
            throw new Error('The extension registry is disposed')
        }
        const { name } = extension
        if (!name || this._records.has(name)) {
            throw new Error(`An extension named "${name}" is already installed`)
        }

        const record: ExtensionRecord = [extension, false]
        this._records.set(name, record)
        try {
            await extension.setup(this._createClient(name))
            if (this._disposed || record[1]) {
                throw new Error('The extension registry was disposed during setup')
            }
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
    }

    async rollback(extension: Extension): Promise<void> {
        const record = this._records.get(extension.name)
        if (record?.[0] === extension) {
            this._records.delete(extension.name)
            await this._disposeRecord(record)
        }
    }

    async dispose(): Promise<void> {
        if (this._disposed) {
            return
        }
        this._disposed = true
        const records = Array.from(this._records.values()).reverse()
        this._records.clear()
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

    private async _disposeRecord(record: ExtensionRecord): Promise<void> {
        if (!record[1]) {
            record[1] = true
            await record[0].dispose?.()
        }
    }
}
