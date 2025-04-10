/* eslint-disable no-console */

import * as React from 'react'
import { render } from '@testing-library/react'
import { PostHogProvider } from '../../context'
import { __POSTHOG_ERROR_WARNING_MESSAGES, PostHogErrorBoundary } from '..'
import posthog from 'posthog-js'

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
        'render_with_error',
        () =>
            ({ message = 'Error', fallback = <div></div>, additionalProperties } = {}) =>
                render(
                    <PostHogProvider client={given.posthog}>
                        <PostHogErrorBoundary fallback={fallback} additionalProperties={additionalProperties}>
                            <ComponentWithError message={message} />
                        </PostHogErrorBoundary>
                    </PostHogProvider>
                )
    )

    given(
        'render_without_error',
        () => () =>
            render(
                <PostHogProvider client={given.posthog}>
                    <PostHogErrorBoundary>
                        <div>Amazing content</div>
                    </PostHogErrorBoundary>
                </PostHogProvider>
            )
    )

    given('posthog', () => ({
        captureException: jest.fn(),
        capture: jest.fn(),
    }))

    it('should call captureException with error message', () => {
        const { container } = given.render_with_error({ message: 'Test error', fallback: <div></div> })
        expect(given.posthog.captureException).toHaveBeenCalledWith(new Error('Test error'), undefined)
        expect(container.innerHTML).toBe('<div></div>')
        expect(console.error).toHaveBeenCalledTimes(2)
    })

    it('should warn user when fallback is not null', () => {
        const { container } = given.render_with_error({ fallback: null })
        expect(given.posthog.captureException).toHaveBeenCalledWith(new Error('Error'), undefined)
        expect(container.innerHTML).toBe('')
        expect(console.warn).toHaveBeenCalledWith(__POSTHOG_ERROR_WARNING_MESSAGES.INVALID_FALLBACK)
    })

    it('should warn user when fallback is a string', () => {
        const { container } = given.render_with_error({ fallback: 'hello' })
        expect(given.posthog.captureException).toHaveBeenCalledWith(new Error('Error'), undefined)
        expect(container.innerHTML).toBe('')
        expect(console.warn).toHaveBeenCalledWith(__POSTHOG_ERROR_WARNING_MESSAGES.INVALID_FALLBACK)
    })

    it('should add additional properties before sending event (as object)', () => {
        const props = { team_id: '1234' }
        given.render_with_error({ message: 'Kaboom', additionalProperties: props })
        expect(given.posthog.captureException).toHaveBeenCalledWith(new Error('Kaboom'), props)
    })

    it('should add additional properties before sending event (as function)', () => {
        const props = { team_id: '1234' }
        given.render_with_error({
            message: 'Kaboom',
            additionalProperties: (err) => {
                expect(err.message).toBe('Kaboom')
                return props
            },
        })
        expect(given.posthog.captureException).toHaveBeenCalledWith(new Error('Kaboom'), props)
    })

    it('should render children without errors', () => {
        const { container } = given.render_without_error()
        expect(container.innerHTML).toBe('<div>Amazing content</div>')
    })
})

describe('captureException processing', () => {
    const originalCapture = posthog.capture
    const originalError = console.error
    const originalWarn = console.warn

    beforeAll(() => {
        console.error = jest.fn()
        console.warn = jest.fn()
        posthog.capture = jest.fn()
    })

    afterAll(() => {
        console.error = originalError
        console.warn = originalWarn
        posthog.capture = originalCapture
    })

    given(
        'render_with_error',
        () =>
            ({ additionalProperties } = {}) =>
                render(
                    <PostHogProvider client={given.posthog}>
                        <PostHogErrorBoundary fallback={<div></div>} additionalProperties={additionalProperties}>
                            <ComponentWithError message={'Kaboom'} />
                        </PostHogErrorBoundary>
                    </PostHogProvider>
                )
    )

    it('should call capture with a stacktrace', () => {
        given.render_with_error()
        const captureCalls = posthog.capture.mock.calls
        expect(captureCalls.length).toBe(1)
        const exceptionList = captureCalls[0][1].$exception_list
        expect(exceptionList.length).toBe(1)
        const stacktrace = exceptionList[0].stacktrace
        expect(stacktrace.frames.length).toBe(36)
    })
})

function ComponentWithError({ message }) {
    throw new Error(message)
}
