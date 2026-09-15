/** Shares an in-flight load, caches success, and permits retrying failed loads. */
export const createChunkLoader = <T>(load: () => T | Promise<T>) => {
    let pending: Promise<T> | undefined
    let loaded: Promise<T> | undefined
    let failed = false

    const start = (): Promise<T> => {
        if (loaded) {
            return loaded
        }
        if (pending) {
            return pending
        }
        const run = async (): Promise<T> => {
            // Publish the shared promise before invoking a loader that can throw or reenter.
            await Promise.resolve()
            try {
                const value = await load()
                loaded = pending
                failed = false
                return value
            } catch (error) {
                failed = true
                throw error
            } finally {
                pending = undefined
            }
        }
        pending = run()
        return pending
    }

    const retryOnce = async (attempt: Promise<T>, shouldRetry: () => boolean): Promise<T> => {
        try {
            return await attempt
        } catch (error) {
            if (!shouldRetry()) {
                throw error
            }
            return start()
        }
    }

    return {
        get loading(): Promise<T> | undefined {
            return pending
        },
        get failed(): boolean {
            return failed
        },
        /** An optional predicate permits one shared retry after this attempt fails. */
        load(shouldRetry?: () => boolean): Promise<T> {
            const attempt = start()
            return shouldRetry ? retryOnce(attempt, shouldRetry) : attempt
        },
    }
}
