/* eslint-disable no-console */

import * as React from 'react'
import { render } from '@testing-library/react'
import { __POSTHOG_ERROR_MESSAGES, PostHogErrorBoundary } from '../PostHogErrorBoundary'
import posthog from 'posthog-js'

describe('PostHogErrorBoundary component', () => {
    mockFunction(console, 'error')
    mockFunction(console, 'warn')
    mockFunction(posthog, 'captureException')

    given('render_with_error', () => (props) => render(<RenderWithError {...props} />))
    given('render_without_error', () => (props) => render(<RenderWithoutError {...props} />))

    it('should call captureException with error message', () => {
        const { container } = given.render_with_error({ message: 'Test error', fallback: <div></div> })
        expect(posthog.captureException).toHaveBeenCalledWith(new Error('Test error'), undefined)
        expect(container.innerHTML).toBe('<div></div>')
        expect(console.error).toHaveBeenCalledTimes(2)
    })

    it('should warn user when fallback is null', () => {
        const { container } = given.render_with_error({ fallback: null })
        expect(posthog.captureException).toHaveBeenCalledWith(new Error('Error'), undefined)
        expect(container.innerHTML).toBe('')
        expect(console.warn).toHaveBeenCalledWith(__POSTHOG_ERROR_MESSAGES.INVALID_FALLBACK)
    })

    it('should warn user when fallback is a string', () => {
        const { container } = given.render_with_error({ fallback: 'hello' })
        expect(posthog.captureException).toHaveBeenCalledWith(new Error('Error'), undefined)
        expect(container.innerHTML).toBe('')
        expect(console.warn).toHaveBeenCalledWith(__POSTHOG_ERROR_MESSAGES.INVALID_FALLBACK)
    })

    it('should add additional properties before sending event (as object)', () => {
        const props = { team_id: '1234' }
        given.render_with_error({ message: 'Kaboom', additionalProperties: props })
        expect(posthog.captureException).toHaveBeenCalledWith(new Error('Kaboom'), props)
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
        expect(posthog.captureException).toHaveBeenCalledWith(new Error('Kaboom'), props)
    })

    it('should render children without errors', () => {
        const { container } = given.render_without_error()
        expect(container.innerHTML).toBe('<div>Amazing content</div>')
    })
})

describe('captureException processing', () => {
    mockFunction(console, 'error')
    mockFunction(console, 'warn')
    mockFunction(posthog, 'capture')

    given('render_with_error', () => (props) => render(<RenderWithError {...props} />))

    it('should call capture with a stacktrace', () => {
        given.render_with_error({ message: 'Kaboom', fallback: <div></div>, additionalProperties: {} })
        const captureCalls = posthog.capture.mock.calls
        expect(captureCalls.length).toBe(1)
        const exceptionList = captureCalls[0][1].$exception_list
        expect(exceptionList.length).toBe(1)
        const stacktrace = exceptionList[0].stacktrace
        expect(stacktrace.frames.length).toBe(36)
    })
})

function mockFunction(object, funcName) {
    const originalFunc = object[funcName]

    beforeEach(() => {
        object[funcName] = jest.fn()
    })

    afterEach(() => {
        object[funcName] = originalFunc
    })
}

function ComponentWithError({ message }) {
    throw new Error(message)
}

function RenderWithError({ message = 'Error', fallback, additionalProperties }) {
    return (
        <PostHogErrorBoundary fallback={fallback} additionalProperties={additionalProperties}>
            <ComponentWithError message={message} />
        </PostHogErrorBoundary>
    )
}

function RenderWithoutError({ additionalProperties }) {
    return (
        <PostHogErrorBoundary fallback={<div></div>} additionalProperties={additionalProperties}>
            <div>Amazing content</div>
        </PostHogErrorBoundary>
    )
}
