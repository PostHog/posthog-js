import { Logger } from '../../utils/logger'

jest.mock('../../utils/logger', () => {
    const mockLogger: Logger = {
        _log: jest.fn(),
        critical: jest.fn(),
        uninitializedWarning: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        createLogger: () => {
            return mockLogger
        },
    }
    return {
        logger: mockLogger,
        createLogger: mockLogger.createLogger,
    }
})

import { logger } from '../../utils/logger'
import { isFunction } from '../../utils/type-utils'

export const clearLoggerMocks = () => {
    Object.values(logger).forEach((mock: any) => {
        if (isFunction(mock.mockClear)) {
            mock.mockClear()
        }
    })
}

export const mockLogger: jest.Mocked<Logger> = logger as any
