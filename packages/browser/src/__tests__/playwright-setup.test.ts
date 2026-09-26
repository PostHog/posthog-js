import type { BrowserContext, Page } from '@playwright/test'
import { start, waitForRemoteConfig, waitForSessionRecordingToStart } from '../../playwright/mocked/utils/setup'

describe('Playwright setup helpers', () => {
    it('awaits async hooks before initialization and before returning', async () => {
        const phases: string[] = []
        const page = {
            goto: vi.fn(),
            evaluate: vi.fn(async () => {
                phases.push('initialize')
            }),
        } as unknown as Page
        const context = { route: vi.fn() } as unknown as BrowserContext

        await start(
            {
                waitForFlags: false,
                runBeforePostHogInit: async () => {
                    await Promise.resolve()
                    phases.push('before')
                },
                runAfterPostHogInit: async () => {
                    await Promise.resolve()
                    await Promise.resolve()
                    phases.push('after')
                },
            },
            page,
            context
        )
        phases.push('returned')

        expect(phases).toEqual(['before', 'initialize', 'after', 'returned'])
    })

    it.each([
        ['recording start', waitForSessionRecordingToStart],
        ['remote config', waitForRemoteConfig],
    ] as const)('passes the %s timeout as Playwright options, not as the page argument', async (_, wait) => {
        const waitForFunction = vi.fn()
        const page = { waitForFunction } as unknown as Page

        await wait(page, 123)

        expect(waitForFunction).toHaveBeenCalledWith(expect.any(Function), undefined, { timeout: 123 })
    })
})
