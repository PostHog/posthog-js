import { createLogger } from '../../src/utils/logger'

afterEach(() => vi.unstubAllGlobals())

describe('logger capability lookup', () => {
    it('resolves the browser console when logging, not when constructing a logger', () => {
        vi.stubGlobal('window', undefined)
        const logger = createLogger('[test]', { debugEnabled: true })
        expect(() => logger.info('server')).not.toThrow()
        const log = vi.fn()
        vi.stubGlobal('window', { console: { log } })
        logger.info('browser')
        expect(log).toHaveBeenCalledWith('[PostHog.js] [test]', 'browser')
    })
})
