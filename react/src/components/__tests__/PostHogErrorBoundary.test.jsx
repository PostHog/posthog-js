/* eslint-disable no-console */

import * as React from 'react'
import { render } from '@testing-library/react'
import { PostHogProvider } from '../../context'
import { PostHogErrorBoundary } from '..'

describe('PostHogErrorBoundary component', () => {
    const originalError = console.error
    const originalWarn = console.warn

    beforeAll(() => {
        console.error = jest.fn()
        console.warn = jest.fn()
    })

    afterAll(() => {
        console.error = originalError
        console.warn = originalWarn
    })

    given(
        'render',
        () =>
            ({ message = 'Error', fallback = <div></div>, additionalProperties }) =>
                render(
                    <PostHogProvider client={given.posthog}>
                        <PostHogErrorBoundary fallback={fallback} additionalProperties={additionalProperties}>
                            <ComponentWithError message={message} />
                        </PostHogErrorBoundary>
                    </PostHogProvider>
                )
    )

    given('posthog', () => ({
        captureException: jest.fn(),
    }))

    it('should call captureException with error message', () => {
        const { container } = given.render({ message: 'Test error', fallback: <div></div> })
        expect(given.posthog.captureException).toHaveBeenCalledWith(new Error('Test error'), undefined)
        expect(container.innerHTML).toBe('<div></div>')
        expect(console.error).toHaveBeenCalledTimes(2)
    })

    it('should warn user when fallback is not valid', () => {
        const { container } = given.render({ fallback: null })
        expect(given.posthog.captureException).toHaveBeenCalledWith(new Error('Error'), undefined)
        expect(container.innerHTML).toBe('')
        expect(console.warn).toHaveBeenCalledWith(
            '[PostHog.js] Invalid fallback prop, provide a valid React element or a function that returns a valid React element.'
        )
    })

    it('should add additional properties before sending event', () => {
        const props = { team_id: '1234' }
        given.render({ message: 'Kaboom', additionalProperties: props })
        expect(given.posthog.captureException).toHaveBeenCalledWith(new Error('Kaboom'), props)
    })
})

function ComponentWithError({ message }) {
    throw new Error(message)
}
