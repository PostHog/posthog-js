// Mock for @vercel/functions in test environment
// Auto-detection in nodeClientCache.ts dynamically imports this module.
// In tests, we control it via jest.mock().
export const waitUntil = undefined
