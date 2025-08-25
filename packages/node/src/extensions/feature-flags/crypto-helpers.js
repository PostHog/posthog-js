/// <reference lib="dom" />
import { Lazy } from './lazy';
const nodeCrypto = new Lazy(async () => {
    try {
        return await import('crypto');
    }
    catch {
        return undefined;
    }
});
export async function getNodeCrypto() {
    return await nodeCrypto.getValue();
}
const webCrypto = new Lazy(async () => {
    if (typeof globalThis.crypto?.subtle !== 'undefined') {
        return globalThis.crypto.subtle;
    }
    try {
        // Node.js: use built-in webcrypto and assign it if needed
        const crypto = await nodeCrypto.getValue();
        if (crypto?.webcrypto?.subtle) {
            return crypto.webcrypto.subtle;
        }
    }
    catch {
        // Ignore if not available
    }
    return undefined;
});
export async function getWebCrypto() {
    return await webCrypto.getValue();
}
//# sourceMappingURL=crypto-helpers.js.map