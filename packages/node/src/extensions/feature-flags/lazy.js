/**
 * A lazy value that is only computed when needed. Inspired by C#'s Lazy<T> class.
 */
export class Lazy {
    constructor(factory) {
        this.factory = factory;
    }
    /**
     * Gets the value, initializing it if necessary.
     * Multiple concurrent calls will share the same initialization promise.
     */
    async getValue() {
        if (this.value !== undefined) {
            return this.value;
        }
        if (this.initializationPromise === undefined) {
            this.initializationPromise = (async () => {
                try {
                    const result = await this.factory();
                    this.value = result;
                    return result;
                }
                finally {
                    // Clear the promise so we can retry if needed
                    this.initializationPromise = undefined;
                }
            })();
        }
        return this.initializationPromise;
    }
    /**
     * Returns true if the value has been initialized.
     */
    isInitialized() {
        return this.value !== undefined;
    }
    /**
     * Returns a promise that resolves when the value is initialized.
     * If already initialized, resolves immediately.
     */
    async waitForInitialization() {
        if (this.isInitialized()) {
            return;
        }
        await this.getValue();
    }
}
//# sourceMappingURL=lazy.js.map