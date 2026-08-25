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
