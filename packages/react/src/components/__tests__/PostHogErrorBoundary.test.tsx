/* eslint-disable no-console */

import * as React from 'react'
import { render } from '@testing-library/react'
import { __POSTHOG_ERROR_MESSAGES, PostHogErrorBoundary } from '../PostHogErrorBoundary'
import posthog from 'posthog-js'
import { setDefaultPostHogInstance } from '../../context/posthog-default'

describe('PostHogErrorBoundary component', () => {
    beforeEach(() => {
        setDefaultPostHogInstance(posthog)
    })

    afterEach(() => {
        setDefaultPostHogInstance(undefined)
    })

    mockFunction(console, 'error')
    mockFunction(console, 'warn')
    mockFunction(posthog, 'captureException')

    const renderWithError = (props: any) => render(<RenderWithError {...props} />)
    const renderWithoutError = (props?: any) => render(<RenderWithoutError {...props} />)

    it('should call captureException with error message', () => {
        const { container } = renderWithError({ message: 'Test error', fallback: <div></div> })
        expect(posthog.captureException).toHaveBeenCalledWith(
            new Error('Test error'),
            expect.objectContaining({ $exception_component_stack: expect.stringContaining('ComponentWithError') })
        )
        expect(container.innerHTML).toBe('<div></div>')
        expect(console.error).toHaveBeenCalledTimes(1)
        expect((console.error as any).mock.calls[0][1].message).toEqual('Test error')
    })

    it('should warn user when fallback is null', () => {
        const { container } = renderWithError({ fallback: null })
        expect(posthog.captureException).toHaveBeenCalledWith(
            new Error('Error'),
            expect.objectContaining({ $exception_component_stack: expect.stringContaining('ComponentWithError') })
        )
        expect(container.innerHTML).toBe('')
        expect(console.warn).toHaveBeenCalledWith(__POSTHOG_ERROR_MESSAGES.INVALID_FALLBACK)
    })

    it('should warn user when fallback is a string', () => {
        const { container } = renderWithError({ fallback: 'hello' })
        expect(posthog.captureException).toHaveBeenCalledWith(
            new Error('Error'),
            expect.objectContaining({ $exception_component_stack: expect.stringContaining('ComponentWithError') })
        )
        expect(container.innerHTML).toBe('')
        expect(console.warn).toHaveBeenCalledWith(__POSTHOG_ERROR_MESSAGES.INVALID_FALLBACK)
    })

    it('should add additional properties before sending event (as object)', () => {
        const props = { team_id: '1234' }
        renderWithError({ message: 'Kaboom', additionalProperties: props })
        expect(posthog.captureException).toHaveBeenCalledWith(
            new Error('Kaboom'),
            expect.objectContaining({
                ...props,
                $exception_component_stack: expect.stringContaining('ComponentWithError'),
            })
        )
    })

    it('should add additional properties before sending event (as function)', () => {
        const props = { team_id: '1234' }
        renderWithError({
            message: 'Kaboom',
            additionalProperties: (err: Error, errorInfo: React.ErrorInfo) => {
                expect(err.message).toBe('Kaboom')
                expect(errorInfo.componentStack).toContain('ComponentWithError')
                return props
            },
        })
        expect(posthog.captureException).toHaveBeenCalledWith(
            new Error('Kaboom'),
            expect.objectContaining({
                ...props,
                $exception_component_stack: expect.stringContaining('ComponentWithError'),
            })
        )
    })

    it('should capture the component stack for primitive exceptions', () => {
        render(
            <PostHogErrorBoundary fallback={<div></div>}>
                <ComponentWithUndefinedError />
            </PostHogErrorBoundary>
        )

        expect(posthog.captureException).toHaveBeenCalledWith(
            undefined,
            expect.objectContaining({
                $exception_component_stack: expect.stringContaining('ComponentWithUndefinedError'),
            })
        )
    })

    it('should render children without errors', () => {
        const { container } = renderWithoutError()
        expect(container.innerHTML).toBe('<div>Amazing content</div>')
    })
})

describe('captureException processing', () => {
    beforeEach(() => {
        setDefaultPostHogInstance(posthog)
    })

    afterEach(() => {
        setDefaultPostHogInstance(undefined)
    })

    mockFunction(console, 'error')
    mockFunction(console, 'warn')
    mockFunction(posthog, 'capture')

    const renderWithError = (props: any) => render(<RenderWithError {...props} />)

    it('should call capture with a stacktrace', () => {
        renderWithError({ message: 'Kaboom', fallback: <div></div>, additionalProperties: {} })
        const captureCalls = (posthog.capture as jest.Mock).mock.calls
        expect(captureCalls.length).toBe(1)
        const exceptionList = captureCalls[0][1].$exception_list
        expect(captureCalls[0][1].$exception_component_stack).toContain('ComponentWithError')
        expect(exceptionList.length).toBe(1)
        const stacktrace = exceptionList[0].stacktrace
        expect(stacktrace.frames.length).toBeGreaterThan(20)
    })
})

function mockFunction(object: any, funcName: string) {
    const originalFunc = object[funcName]

    beforeEach(() => {
        object[funcName] = jest.fn()
    })

    afterEach(() => {
        object[funcName] = originalFunc
    })
}

function ComponentWithError({ message }: { message: string }): React.ReactElement {
    throw new Error(message)
}

function ComponentWithUndefinedError(): React.ReactElement {
    throw undefined
}

function RenderWithError({ message = 'Error', fallback, additionalProperties }: any) {
    return (
        <PostHogErrorBoundary fallback={fallback} additionalProperties={additionalProperties}>
            <ComponentWithError message={message} />
        </PostHogErrorBoundary>
    )
}

function RenderWithoutError({ additionalProperties }: any) {
    return (
        <PostHogErrorBoundary fallback={<div></div>} additionalProperties={additionalProperties}>
            <div>Amazing content</div>
        </PostHogErrorBoundary>
    )
}
