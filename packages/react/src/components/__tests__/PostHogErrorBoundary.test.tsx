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
        expect(posthog.captureException).toHaveBeenCalledWith(expect.any(Error), undefined)
        expectCapturedReactError()
        expect(container.innerHTML).toBe('<div></div>')
        expect(console.error).toHaveBeenCalledTimes(1)
        expect((console.error as any).mock.calls[0][1].message).toEqual('Test error')
    })

    it('should warn user when fallback is null', () => {
        const { container } = renderWithError({ fallback: null })
        expect(posthog.captureException).toHaveBeenCalledWith(expect.any(Error), undefined)
        expectCapturedReactError()
        expect(container.innerHTML).toBe('')
        expect(console.warn).toHaveBeenCalledWith(__POSTHOG_ERROR_MESSAGES.INVALID_FALLBACK)
    })

    it('should warn user when fallback is a string', () => {
        const { container } = renderWithError({ fallback: 'hello' })
        expect(posthog.captureException).toHaveBeenCalledWith(expect.any(Error), undefined)
        expectCapturedReactError()
        expect(container.innerHTML).toBe('')
        expect(console.warn).toHaveBeenCalledWith(__POSTHOG_ERROR_MESSAGES.INVALID_FALLBACK)
    })

    it('should add additional properties before sending event (as object)', () => {
        const props = { team_id: '1234' }
        renderWithError({ message: 'Kaboom', additionalProperties: props })
        expect(posthog.captureException).toHaveBeenCalledWith(expect.any(Error), props)
        expectCapturedReactError()
    })

    it('should add additional properties before sending event (as function)', () => {
        const props = { team_id: '1234' }
        renderWithError({
            message: 'Kaboom',
            additionalProperties: (err: Error, errorInfo: React.ErrorInfo) => {
                expect(err.message).toBe('Kaboom')
                expect(errorInfo.componentStack).toContain('PostHogErrorBoundary.test.tsx')
                return props
            },
        })
        expect(posthog.captureException).toHaveBeenCalledWith(expect.any(Error), props)
        expectCapturedReactError()
    })

    it('should capture the component stack for primitive exceptions', () => {
        render(
            <PostHogErrorBoundary fallback={<div></div>}>
                <ComponentWithUndefinedError />
            </PostHogErrorBoundary>
        )

        expect(posthog.captureException).toHaveBeenCalledWith(expect.any(Error), undefined)
        const capturedError = (posthog.captureException as jest.Mock).mock.calls[0][0]
        expect(capturedError).toEqual(
            expect.objectContaining({
                message: 'Primitive value captured as exception: undefined',
                name: 'React ErrorBoundary Error',
                stack: expect.stringContaining('ComponentWithUndefinedError'),
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
        expect(exceptionList.length).toBe(2)
        const stacktrace = exceptionList[0].stacktrace
        expect(stacktrace.frames.length).toBeGreaterThan(20)
        expect(exceptionList[1].type).toBe('React ErrorBoundary Error')
        expectComponentStackFrames(exceptionList[1].stacktrace.frames, 'PostHogErrorBoundary')
    })

    it('should parse the component stack for primitive exceptions', () => {
        render(
            <PostHogErrorBoundary fallback={<div></div>}>
                <ComponentWithUndefinedError />
            </PostHogErrorBoundary>
        )

        const captureCalls = (posthog.capture as jest.Mock).mock.calls
        const exceptionList = captureCalls[0][1].$exception_list
        expect(exceptionList).toHaveLength(1)
        expect(exceptionList[0].type).toBe('React ErrorBoundary Error')
        expectComponentStackFrames(exceptionList[0].stacktrace.frames, 'ComponentWithUndefinedError')
    })
})

function expectComponentStackFrames(frames: Array<{ function?: string }>, expectedFunction: string) {
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.some((frame) => frame.function === expectedFunction)).toBe(true)
}

function expectCapturedReactError() {
    const capturedError = (posthog.captureException as jest.Mock).mock.calls[0][0]
    expect(capturedError.cause.name).toBe('React ErrorBoundary Error')
    expect(capturedError.cause.stack).toContain('PostHogErrorBoundary.test.tsx')
}

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
