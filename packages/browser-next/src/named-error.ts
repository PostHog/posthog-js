/**
 * Sets `error.name` in a way that also holds on pages where a browser extension has made
 * `Error.prototype.name` non-writable, where a plain `error.name = ...` throws in strict mode.
 * An own property on the instance shadows the prototype property. The descriptor matches what
 * a plain assignment produces, so the error is unchanged everywhere else.
 */
export const defineErrorName = (error: Error, name: string): void => {
    try {
        Object.defineProperty(error, 'name', { value: name, writable: true, enumerable: true, configurable: true })
    } catch {
        // a page hostile enough to harden `Error.prototype` can also patch `Object.defineProperty`
    }
}
