/**
 * Walks the `__rrweb_original__` markers console plugins leave behind to reach the
 * real console method. Shared by the main bundle's recorder and the logs entrypoint
 * so a change to the marker protocol can't be applied to only one of them.
 */
export const originalConsoleMethod = (method: any): any => {
    while (method?.__rrweb_original__) {
        method = method.__rrweb_original__
    }
    return method
}
