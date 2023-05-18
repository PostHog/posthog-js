import { v4 } from 'uuid'
import { createPosthogInstance } from './posthog-instance'
import { waitFor } from '@testing-library/dom'
import { getRequests } from './mock-server'

test('person properties set in identify() are sent to decide', async () => {
    const token = v4()
    const posthog = await createPosthogInstance(token, { advanced_disable_decide: false })

    const anonymousId = posthog.get_distinct_id()

    posthog.identify('test-id', {
        email: 'test@email.com',
    })

    await waitFor(() =>
        expect(getRequests(token)['/e/']).toContainEqual(
            expect.objectContaining({
                event: '$identify',
                $set: { email: 'test@email.com' },
            })
        )
    )

    await waitFor(() => {
        expect(getRequests(token)['/decide/']).toEqual([
            {
                distinct_id: anonymousId,
                groups: {},
                token,
            },
            {
                $anon_distinct_id: anonymousId,
                distinct_id: 'test-id',
                groups: {},
                token,
            },
        ])
    })
})
