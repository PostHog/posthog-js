import { collectEnvironment } from '../extensions/environment'

describe('collectEnvironment', () => {
    it('collects coarse, non-identifying runtime facts', () => {
        const env = collectEnvironment({}, true)
        expect(typeof env.os).toBe('string')
        expect(typeof env.arch).toBe('string')
        expect(env.runtime).toMatch(/^(node|bun|deno)\//)
        expect(env.isTty).toBe(true)
        expect(env.isCi).toBe(false)
    })

    it('reflects CI from the environment', () => {
        expect(collectEnvironment({ CI: 'true' }, false).isCi).toBe(true)
        expect(collectEnvironment({ GITHUB_ACTIONS: '1' }, false).isCi).toBe(true)
    })
})
