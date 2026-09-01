export type MaybePromise<T> = T | Promise<T>

/** Chain sync and async values without deferring synchronous work to a microtask. */
export const continueWith = <T, R>(
    result: MaybePromise<T>,
    callback: (value: T) => MaybePromise<R>
): MaybePromise<R> => {
    const promise = result as Promise<T>
    return promise?.then ? promise.then(callback) : callback(result as T)
}
