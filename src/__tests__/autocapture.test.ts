/// <reference lib="dom" />
/* eslint-disable compat/compat */

import { Autocapture } from '../extensions/dom-autocapture/autocapture'
import { AUTOCAPTURE_DISABLED_SERVER_SIDE } from '../constants'
import { DecideResponse } from '../types'
import { PostHog } from '../posthog-core'
import { assignableWindow, window } from '../utils/globals'
import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { isUndefined } from '../utils/type-utils'
import * as utils from '../utils'
import { LazilyLoadedDOMAutocapture } from '../entrypoints/dom-autocapture'

// JS DOM doesn't have ClipboardEvent, so we need to mock it
// see https://github.com/jsdom/jsdom/issues/1568
class MockClipboardEvent extends Event implements ClipboardEvent {
    clipboardData: DataTransfer | null = null
    type: 'copy' | 'cut' | 'paste' = 'copy'
}
window!.ClipboardEvent = MockClipboardEvent

export function makeMouseEvent(partialEvent: Partial<MouseEvent>) {
    return { type: 'click', ...partialEvent } as unknown as MouseEvent
}

describe('Autocapture system', () => {
    const originalWindowLocation = window!.location

    let autocapture: Autocapture
    let posthog: PostHog
    let captureMock: jest.Mock

    beforeEach(async () => {
        jest.spyOn(window!.console, 'log').mockImplementation()
        jest.spyOn(utils, 'registerEvent')

        Object.defineProperty(window, 'location', {
            configurable: true,
            enumerable: true,
            writable: true,
            // eslint-disable-next-line compat/compat
            value: new URL('https://example.com'),
        })

        captureMock = jest.fn()

        assignableWindow.__PosthogExtensions__ = {}
        assignableWindow.__PosthogExtensions__.DOMAutocapture = (ph) => new LazilyLoadedDOMAutocapture(ph)
        assignableWindow.__PosthogExtensions__.loadExternalDependency = jest
            .fn()
            .mockImplementation((_ph, _path, callback) => {
                callback()
            })

        posthog = await createPosthogInstance(uuidv7(), {
            api_host: 'https://test.com',
            token: 'testtoken',
            autocapture: true,
            _onCapture: captureMock,
        })

        if (isUndefined(posthog.autocapture)) {
            throw new Error('helping TS by confirming this is created by now')
        }
        autocapture = posthog.autocapture
    })

    afterEach(() => {
        document.getElementsByTagName('html')[0].innerHTML = ''

        Object.defineProperty(window, 'location', {
            configurable: true,
            enumerable: true,
            value: originalWindowLocation,
        })
    })

    describe('isBrowserSupported', () => {
        let orig: typeof document.querySelectorAll

        beforeEach(() => {
            orig = document.querySelectorAll
        })

        afterEach(() => {
            document.querySelectorAll = orig
        })

        it('should return true if document.querySelectorAll is a function', () => {
            document.querySelectorAll = function () {
                return [] as unknown as NodeListOf<Element>
            }
            expect(autocapture.isBrowserSupported()).toBe(true)
        })

        it('should return false if document.querySelectorAll is not a function', () => {
            document.querySelectorAll = undefined as unknown as typeof document.querySelectorAll
            expect(autocapture.isBrowserSupported()).toBe(false)
        })
    })

    describe('afterDecideResponse()', () => {
        beforeEach(() => {
            document.title = 'test page'
        })

        it('should not be enabled before the decide response', () => {
            expect(autocapture.isEnabled).toBe(false)
        })

        it('should be enabled before the decide response if decide is disabled', () => {
            posthog.config.advanced_disable_decide = true
            expect(autocapture.isEnabled).toBe(true)
        })

        it('should be disabled before the decide response if opt out is in persistence', () => {
            posthog.persistence!.props[AUTOCAPTURE_DISABLED_SERVER_SIDE] = true
            expect(autocapture.isEnabled).toBe(false)
        })

        it('should be disabled before the decide response if client side opted out', () => {
            posthog.config.autocapture = false
            expect(autocapture.isEnabled).toBe(false)
        })

        it.each([
            // when client side is opted out, it is always off
            [false, true, false],
            [false, false, false],
            // when client side is opted in, it is only on, if the remote does not opt out
            [true, true, false],
            [true, false, true],
        ])(
            'when client side config is %p and remote opt out is %p - autocapture enabled should be %p',
            (clientSideOptIn, serverSideOptOut, expected) => {
                posthog.config.autocapture = clientSideOptIn
                autocapture.afterDecideResponse({
                    autocapture_opt_out: serverSideOptOut,
                } as DecideResponse)
                expect(autocapture.isEnabled).toBe(expected)
            }
        )

        it('should call _addDomEventHandlders if autocapture is true in client config', () => {
            posthog.config.autocapture = true
            autocapture.afterDecideResponse({} as DecideResponse)
            expect(utils.registerEvent).toHaveBeenCalled()
        })

        it('should not call _addDomEventHandlders if autocapture is opted out in server config', () => {
            autocapture.afterDecideResponse({ autocapture_opt_out: true } as DecideResponse)
            expect(utils.registerEvent).not.toHaveBeenCalled()
        })

        it('should not call _addDomEventHandlders if autocapture is disabled in client config', () => {
            expect(utils.registerEvent).not.toHaveBeenCalled()
            posthog.config.autocapture = false

            autocapture.afterDecideResponse({} as DecideResponse)

            expect(utils.registerEvent).not.toHaveBeenCalled()
        })

        it('should NOT call _addDomEventHandlders when the token has already been initialized', () => {
            autocapture.afterDecideResponse({} as DecideResponse)
            expect(utils.registerEvent).toHaveBeenCalledTimes(3)

            autocapture.afterDecideResponse({} as DecideResponse)
            expect(utils.registerEvent).toHaveBeenCalledTimes(3)
        })
    })
})
