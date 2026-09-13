/** @vitest-environment jsdom */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PostHogErrorBoundary } from '../src/PostHogErrorBoundary'
import { PostHogContext } from '../src/PostHogContext'
import type { PostHog } from '../src/posthog-rn'

function ThrowValue({ value }: { value: unknown }): React.ReactElement {
  throw value
}

describe('PostHogErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it.each([null, undefined, false, 0, '', new Error('render failed')])(
    'renders the fallback for a thrown %s',
    (value) => {
      render(
        <PostHogErrorBoundary fallback={<span>Fallback</span>}>
          <ThrowValue value={value} />
        </PostHogErrorBoundary>
      )
      expect(screen.getByText('Fallback')).toBeTruthy()
    }
  )

  it('captures the component stack with additional properties and preserves the thrown error', () => {
    const captureException = vi.fn()
    const error = new Error('render failed')
    const additionalProperties = vi.fn(() => ({ orderId: '123' }))
    render(
      <PostHogContext.Provider value={{ client: { captureException } as unknown as PostHog }}>
        <PostHogErrorBoundary additionalProperties={additionalProperties} fallback={<span>Fallback</span>}>
          <ThrowValue value={error} />
        </PostHogErrorBoundary>
      </PostHogContext.Provider>
    )
    expect(additionalProperties).toHaveBeenCalledWith(error)
    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureException).toHaveBeenCalledWith(error, {
      orderId: '123',
      $exception_component_stack: expect.stringContaining('ThrowValue'),
    })
  })

  it('can recover and catch another error using resetError', () => {
    let shouldThrow = true
    function Child(): React.ReactElement {
      if (shouldThrow) {
        throw new Error('render failed')
      }
      return <span>Recovered</span>
    }
    const fallback = vi.fn(({ resetError }) => <button onClick={resetError}>Retry</button>)
    const tree = () => (
      <PostHogErrorBoundary fallback={fallback}>
        <Child />
      </PostHogErrorBoundary>
    )
    const view = render(tree())
    expect(fallback).toHaveBeenLastCalledWith(
      expect.objectContaining({
        error: expect.any(Error),
        componentStack: expect.stringContaining('Child'),
        resetError: expect.any(Function),
      }),
      expect.anything()
    )
    shouldThrow = false
    fireEvent.click(screen.getByText('Retry'))
    expect(screen.getByText('Recovered')).toBeTruthy()
    shouldThrow = true
    view.rerender(tree())
    expect(screen.getByText('Retry')).toBeTruthy()
    fireEvent.click(screen.getByText('Retry'))
    expect(screen.getByText('Retry')).toBeTruthy()
  })

  it.each(['properties', 'capture'])('keeps the fallback when %s throws', (source) => {
    const fail = () => {
      throw new Error('reporting failed')
    }
    render(
      <PostHogContext.Provider
        value={{ client: { captureException: source === 'capture' ? fail : vi.fn() } as unknown as PostHog }}
      >
        <PostHogErrorBoundary
          additionalProperties={source === 'properties' ? fail : { orderId: '123' }}
          fallback={({ componentStack }) => <span>Fallback: {componentStack}</span>}
        >
          <ThrowValue value={new Error('render failed')} />
        </PostHogErrorBoundary>
      </PostHogContext.Provider>
    )
    expect(screen.getByText(/Fallback:/).textContent).toContain('ThrowValue')
  })

  it('preserves function children and renders nothing without a fallback', () => {
    const view = render(<PostHogErrorBoundary>{() => <span>Healthy</span>}</PostHogErrorBoundary>)
    expect(screen.getByText('Healthy')).toBeTruthy()
    view.rerender(
      <PostHogErrorBoundary>
        <ThrowValue value={new Error('render failed')} />
      </PostHogErrorBoundary>
    )
    expect(view.container.textContent).toBe('')
  })
})
