import { jest } from '@jest/globals'

export const snapshotTestGlobals = {
    ...jest.requireActual('@posthog/browser-common/utils/globals'),
    userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}
