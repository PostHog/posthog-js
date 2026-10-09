import type { PosthogJsLogger } from '@posthog/browser-common/utils/logger'

vi.mock('@posthog/browser-common/utils/logger', () => {
    const mockLogger: PosthogJsLogger = {
        _log: vi.fn(),
        debug: vi.fn(),
        critical: vi.fn(),
        uninitializedWarning: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        createLogger: vi.fn(() => mockLogger),
    }
    return {
        logger: mockLogger,
        createLogger: mockLogger.createLogger,
    }
})

import { logger } from '@posthog/browser-common/utils/logger'

export const clearLoggerMocks = () => {
    Object.values(logger).forEach((mock) => {
        if (vi.isMockFunction(mock)) {
            mock.mockClear()
        }
    })
}

export const mockLogger = vi.mocked(logger)
