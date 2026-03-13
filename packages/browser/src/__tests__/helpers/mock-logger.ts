import type { Logger } from '@posthog/core'

vi.mock('../../utils/logger', () => {
    const mockLogger: Logger = {
        _log: vi.fn(),
        critical: vi.fn(),
        uninitializedWarning: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        createLogger: () => {
            return mockLogger
        },
    }
    return {
        logger: mockLogger,
        createLogger: mockLogger.createLogger,
    }
})

import { isFunction } from '@posthog/core'
import { logger } from '../../utils/logger'

export const clearLoggerMocks = () => {
    Object.values(logger).forEach((mock: any) => {
        if (isFunction(mock.mockClear)) {
            mock.mockClear()
        }
    })
}

export const mockLogger: vi.Mocked<Logger> = logger as any
