/* eslint-disable no-console */

import * as React from 'react'
import { render } from '@testing-library/react'
import { __POSTHOG_ERROR_MESSAGES, PostHogErrorBoundary } from '../PostHogErrorBoundary'
import posthog from 'posthog-js'

describe('PostHogErrorBoundary component', () => {
    mockFunction(console, 'error')
    mockFunction(console, 'warn')
    mockFunction(posthog, 'captureException')

    const renderWithError = (props) => render(<RenderWithError {...props} />)
    const renderWithoutError = (props) => render(<RenderWithoutError {...props} />)

    it('should call captureException with error message', () => {
        const { container } = renderWithError({ message: 'Test error', fallback: <div></div> })
        expect(posthog.captureException).toHaveBeenCalledWith(new Error('Test error'), undefined)
        expect(container.innerHTML).toBe('<div></div>')
        expect(console.error).toHaveBeenCalledTimes(2)
    })

    it('should warn user when fallback is null', () => {
        const { container } = renderWithError({ fallback: null })
        expect(posthog.captureException).toHaveBeenCalledWith(new Error('Error'), undefined)
        expect(container.innerHTML).toBe('')
        expect(console.warn).toHaveBeenCalledWith(__POSTHOG_ERROR_MESSAGES.INVALID_FALLBACK)
    })

    it('should warn user when fallback is a string', () => {
        const { container } = renderWithError({ fallback: 'hello' })
        expect(posthog.captureException).toHaveBeenCalledWith(new Error('Error'), undefined)
        expect(container.innerHTML).toBe('')
        expect(console.warn).toHaveBeenCalledWith(__POSTHOG_ERROR_MESSAGES.INVALID_FALLBACK)
    })

    it('should add additional properties before sending event (as object)', () => {
        const props = { team_id: '1234' }
        renderWithError({ message: 'Kaboom', additionalProperties: props })
        expect(posthog.captureException).toHaveBeenCalledWith(new Error('Kaboom'), props)
    })

    it('should add additional properties before sending event (as function)', () => {
        const props = { team_id: '1234' }
        renderWithError({
            message: 'Kaboom',
            additionalProperties: (err) => {
                expect(err.message).toBe('Kaboom')
                return props
            },
        })
        expect(posthog.captureException).toHaveBeenCalledWith(new Error('Kaboom'), props)
    })

    it('should render children without errors', () => {
        const { container } = renderWithoutError()
        expect(container.innerHTML).toBe('<div>Amazing content</div>')
    })
})

describe('captureException processing', () => {
    mockFunction(console, 'error')
    mockFunction(console, 'warn')
    mockFunction(posthog, 'capture')

    const renderWithError = (props) => render(<RenderWithError {...props} />)

    it('should call capture with a stacktrace', () => {
        renderWithError({ message: 'Kaboom', fallback: <div></div>, additionalProperties: {} })
        const captureCalls = posthog.capture.mock.calls
        expect(captureCalls.length).toBe(1)
        const exceptionList = captureCalls[0][1].$exception_list
        expect(exceptionList.length).toBe(1)
        const stacktrace = exceptionList[0].stacktrace
        expect(stacktrace.frames.length).toBe(44)
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
