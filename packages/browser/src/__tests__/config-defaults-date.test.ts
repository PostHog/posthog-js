import { CONFIG_DEFAULTS_DATES } from '@posthog/types'
import { PostHog } from '../posthog-core'

vi.mock('@posthog/types', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@posthog/types')>()),
    CONFIG_DEFAULTS_DATES: Object.freeze(['2026-08-30', '2099-01-01', '2025-05-24']),
}))

it('reports the newest supported defaults date regardless of list order', () => {
    const posthog = new PostHog()
    posthog._init('test-token', { defaults: 'latest' })

    expect(posthog.calculateEventProperties('test_event', {}).$config_defaults).toBe('2099-01-01')
    expect(CONFIG_DEFAULTS_DATES).toStrictEqual(['2026-08-30', '2099-01-01', '2025-05-24'])
})
