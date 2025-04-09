/* eslint-disable no-console */

import * as React from 'react'
import { render } from '@testing-library/react'
import { PostHogProvider } from '../../context'
import { PostHogErrorBoundary } from '..'

describe('PostHogErrorBoundary component', () => {
    const originalError = console.error
    beforeAll(() => {
        console.error = jest.fn()
    })
    afterAll(() => {
        console.error = originalError
    })

    given(
        'render',
        () => () =>
            render(
                <PostHogProvider client={given.posthog}>
                    <PostHogErrorBoundary fallback={<div></div>}>
                        <ComponentWithError />
                    </PostHogErrorBoundary>
                </PostHogProvider>
            )
    )

    given('posthog', () => ({
        captureException: jest.fn(),
    }))

    it('should call captureException with error message', () => {
        const { container } = given.render()
        const mockFn = given.posthog.captureException
        expect(mockFn).toHaveBeenCalledTimes(1)
        let [lastCall] = mockFn.mock.calls
        const [err] = lastCall
        expect(err.message).toBe('Test error')
        expect(container.innerHTML).toContain('<div></div>')
        expect(console.error).toHaveBeenCalledTimes(2)
    })
})

function ComponentWithError() {
    throw new Error('Test error')
}
