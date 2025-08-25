export class PostHogMemoryStorage {
    constructor() {
        this._memoryStorage = {};
    }
    getProperty(key) {
        return this._memoryStorage[key];
    }
    setProperty(key, value) {
        this._memoryStorage[key] = value !== null ? value : undefined;
    }
}
//# sourceMappingURL=storage-memory.js.map