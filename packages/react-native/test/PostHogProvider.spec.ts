/** @jest-environment jsdom */
import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { render, cleanup } from '@testing-library/react'
import { AppState, Linking, Platform } from 'react-native'

import { PostHogProvider } from '../src/PostHogProvider'
import { usePostHog } from '../src/hooks/usePostHog'
import type { PostHog } from '../src/posthog-rn'

Linking.getInitialURL = jest.fn(() => Promise.resolve(null))
AppState.addEventListener = jest.fn()

const CaptureClient = ({ onClient }: { onClient: (client: PostHog) => void }) => {
  const posthog = usePostHog()

  useEffect(() => {
    onClient(posthog)
  }, [onClient, posthog])

  return null
}

const createClient = (): any => ({ debug: jest.fn(), autocapture: jest.fn() })

// Named so the element walk finds a label for it; a bare <button> yields no label at all,
// which would make the outside-the-provider assertion pass for the wrong reason.
const OutsideAppComponent = (): any => React.createElement('button', { type: 'button' }, 'outside')

const renderOnWeb = (
  client: any,
  children: React.ReactNode = React.createElement('button', { type: 'button' }, 'press me')
): ReturnType<typeof render> => {
  Platform.OS = 'web'
  return render(
    React.createElement(
      PostHogProvider,
      { client, autocapture: { captureTouches: true, captureScreens: false } },
      children
    )
  )
}

const autocaptureProps = { captureTouches: true, captureScreens: false }

// Two providers side by side; pass the same client twice to exercise the shared listener,
// or two clients to exercise per-client scoping.
const renderTwoProvidersOnWeb = (
  clientA: any,
  clientB: any,
  childrenA: React.ReactNode = null,
  childrenB: React.ReactNode = null
): ReturnType<typeof render> => {
  Platform.OS = 'web'
  return render(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(PostHogProvider, { client: clientA, autocapture: autocaptureProps }, childrenA),
      React.createElement(PostHogProvider, { client: clientB, autocapture: autocaptureProps }, childrenB)
    )
  )
}

describe('PostHogProvider web click capture', () => {
  const nativePlatform = Platform.OS

  afterEach(() => {
    Platform.OS = nativePlatform
    cleanup()
  })

  it('should capture a click as $event_type click', () => {
    const client = createClient()
    const { getByText } = renderOnWeb(client)

    getByText('press me').click()

    expect(client.autocapture).toHaveBeenCalledTimes(1)
    expect(client.autocapture.mock.calls[0][0]).toEqual('click')
  })

  it('should capture each provider with its own options, not the first to mount', () => {
    const client = createClient()
    Platform.OS = 'web'
    render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          PostHogProvider,
          { client, autocapture: { captureTouches: true, captureScreens: false, customLabelProp: 'first-label' } },
          React.createElement('button', { type: 'button', 'first-label': 'from-first' } as any, 'first')
        ),
        React.createElement(
          PostHogProvider,
          { client, autocapture: { captureTouches: true, captureScreens: false, customLabelProp: 'second-label' } },
          React.createElement('button', { type: 'button', 'second-label': 'from-second' } as any, 'second')
        )
      )
    )

    const buttons = Array.from(document.querySelectorAll('button'))
    ;(buttons.find((b) => b.textContent === 'second') as HTMLButtonElement).click()

    expect(client.autocapture).toHaveBeenCalledTimes(1)
    const tags = client.autocapture.mock.calls[0][1].map((el: any) => el.tag_name)
    expect(tags).toContain('from-second')
  })

  it('should not capture a click outside the provider', () => {
    const client = createClient()
    Platform.OS = 'web'
    render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          PostHogProvider,
          { client, autocapture: { captureTouches: true, captureScreens: false } },
          React.createElement('button', { type: 'button' }, 'inside')
        ),
        React.createElement(OutsideAppComponent, null)
      )
    )

    const buttons = Array.from(document.querySelectorAll('button'))
    ;(buttons.find((b) => b.textContent === 'outside') as HTMLButtonElement).click()
    expect(client.autocapture).not.toHaveBeenCalled()
    ;(buttons.find((b) => b.textContent === 'inside') as HTMLButtonElement).click()
    expect(client.autocapture).toHaveBeenCalledTimes(1)
  })

  it('should route a click to the owning client when two clients are mounted', () => {
    const clientA = createClient()
    const clientB = createClient()
    renderTwoProvidersOnWeb(
      clientA,
      clientB,
      React.createElement('button', { type: 'button' }, 'in-a'),
      React.createElement('button', { type: 'button' }, 'in-b')
    )

    const buttons = Array.from(document.querySelectorAll('button'))
    ;(buttons.find((b) => b.textContent === 'in-b') as HTMLButtonElement).click()

    expect(clientB.autocapture).toHaveBeenCalledTimes(1)
    expect(clientA.autocapture).not.toHaveBeenCalled()
  })

  it('should enqueue exactly one event when two providers share a client', () => {
    const client = createClient()
    renderTwoProvidersOnWeb(
      client,
      client,
      React.createElement('button', { type: 'button' }, 'press me'),
      React.createElement('span', null, 'sibling')
    )
    ;(document.querySelector('button') as HTMLButtonElement).click()

    expect(client.autocapture).toHaveBeenCalledTimes(1)
  })

  it('should detach the shared listener only when the last provider unmounts', () => {
    const removeEventListener = jest.spyOn(document, 'removeEventListener')
    const client = createClient()
    const { rerender, unmount } = renderTwoProvidersOnWeb(client, client)

    const before = removeEventListener.mock.calls.filter((c) => c[0] === 'click').length
    rerender(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(PostHogProvider, { client, autocapture: autocaptureProps })
      )
    )
    expect(removeEventListener.mock.calls.filter((c) => c[0] === 'click').length).toBe(before)

    unmount()
    expect(removeEventListener.mock.calls.filter((c) => c[0] === 'click').length).toBe(before + 1)
    removeEventListener.mockRestore()
  })

  it('should listen in the capture phase, since RNW Pressable stops propagation', () => {
    const addEventListener = jest.spyOn(document, 'addEventListener')

    renderOnWeb(createClient())

    const click = addEventListener.mock.calls.find(([type]) => type === 'click')
    expect(click).toBeDefined()
    expect(click?.[2]).toEqual(true)
    addEventListener.mockRestore()
  })

  it('should capture a click inside portalled content, as RNW Modal renders outside the provider', () => {
    const client = createClient()
    const { getByText } = renderOnWeb(
      client,
      createPortal(React.createElement('button', { type: 'button' }, 'in a modal'), document.body)
    )

    getByText('in a modal').click()

    expect(client.autocapture).toHaveBeenCalledTimes(1)
    expect(client.autocapture.mock.calls[0][0]).toEqual('click')
  })

  it('should keep the same listener across re-renders when autocapture options are inline', () => {
    const client = createClient()
    const addEventListener = jest.spyOn(document, 'addEventListener')
    const element = React.createElement(
      PostHogProvider,
      { client, autocapture: { captureTouches: true, captureScreens: false } },
      React.createElement('button', { type: 'button' }, 'press me')
    )

    Platform.OS = 'web'
    const { rerender } = render(element)
    rerender(element)
    rerender(element)

    expect(addEventListener.mock.calls.filter(([type]) => type === 'click')).toHaveLength(1)
    addEventListener.mockRestore()
  })

  it('should remove the click listener on unmount', () => {
    const removeEventListener = jest.spyOn(document, 'removeEventListener')
    const client = createClient()
    const { unmount, container } = renderOnWeb(client)
    const button = container.querySelector('button') as HTMLButtonElement

    unmount()
    button.click()

    expect(removeEventListener.mock.calls.some(([type, , capture]) => type === 'click' && capture === true)).toEqual(
      true
    )
    expect(client.autocapture).not.toHaveBeenCalled()
    removeEventListener.mockRestore()
  })

  it('should not listen for clicks on native, where onTouchEndCapture already fires', () => {
    const addEventListener = jest.spyOn(document, 'addEventListener')
    const client = createClient()

    render(
      React.createElement(
        PostHogProvider,
        { client, autocapture: { captureTouches: true, captureScreens: false } },
        React.createElement('button', { type: 'button' }, 'press me')
      )
    )

    expect(addEventListener.mock.calls.filter(([type]) => type === 'click')).toHaveLength(0)
    expect(client.autocapture).not.toHaveBeenCalled()
    addEventListener.mockRestore()
  })

  it('should not listen for clicks when captureTouches is off', () => {
    const addEventListener = jest.spyOn(document, 'addEventListener')

    Platform.OS = 'web'
    render(
      React.createElement(
        PostHogProvider,
        { client: createClient(), autocapture: { captureScreens: false } },
        React.createElement('button', { type: 'button' }, 'press me')
      )
    )

    expect(addEventListener.mock.calls.filter(([type]) => type === 'click')).toHaveLength(0)
    addEventListener.mockRestore()
  })
})

describe('PostHogProvider', () => {
  beforeEach(() => {
    ;(globalThis as any).window.fetch = jest.fn(async () => ({
      status: 200,
      json: () => Promise.resolve({ featureFlags: {} }),
    }))
  })

  afterEach(() => {
    cleanup()
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('should render a disabled client instead of throwing when the api key is %s', (_case, apiKey) => {
    const onClient = jest.fn()
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      expect(() => {
        render(
          React.createElement(
            PostHogProvider,
            { apiKey, autocapture: false, options: { persistence: 'memory' } },
            React.createElement(CaptureClient, { onClient })
          )
        )
      }).not.toThrow()

      const posthog = onClient.mock.calls[0][0] as PostHog
      expect(posthog.isDisabled).toEqual(true)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "You must pass your PostHog project's api key. The client will be disabled."
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})
