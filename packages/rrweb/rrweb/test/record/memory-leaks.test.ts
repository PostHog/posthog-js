import { describe, it, expect, beforeEach, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import record from '../../src/record'
import { mutationBuffers } from '../../src/record/observer'
import type { eventWithTime } from '@posthog/rrweb-types'

describe('memory leak prevention', () => {
    let dom: JSDOM
    let document: Document
    let window: Window & typeof globalThis
    let events: eventWithTime[]

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        })
        document = dom.window.document
        window = dom.window as unknown as Window & typeof globalThis
        events = []
        // Clear any existing mutation buffers
        mutationBuffers.length = 0

        // Make window and all its properties global for record to use
        global.window = window as any
        global.document = document as any
        global.Element = dom.window.Element as any
        global.HTMLElement = dom.window.HTMLElement as any
        global.HTMLFormElement = dom.window.HTMLFormElement as any
        global.HTMLImageElement = dom.window.HTMLImageElement as any
        global.HTMLCanvasElement = dom.window.HTMLCanvasElement as any
        global.HTMLAnchorElement = dom.window.HTMLAnchorElement as any
        global.HTMLStyleElement = dom.window.HTMLStyleElement as any
        global.HTMLLinkElement = dom.window.HTMLLinkElement as any
        global.HTMLScriptElement = dom.window.HTMLScriptElement as any
        global.HTMLMediaElement = dom.window.HTMLMediaElement as any
        global.SVGElement = dom.window.SVGElement as any
        global.Node = dom.window.Node as any
        global.MutationObserver = dom.window.MutationObserver as any
    })

    describe('mutationBuffers cleanup', () => {
        it('should clear mutationBuffers array after stopping recording', () => {
            const emit = (event: eventWithTime) => {
                events.push(event)
            }

            // Start recording
            const stopRecording = record({
                emit,
            })

            // Verify buffers were created
            expect(mutationBuffers.length).toBeGreaterThan(0)
            const initialBufferCount = mutationBuffers.length

            // Stop recording
            stopRecording?.()

            // Verify buffers array is cleared
            expect(mutationBuffers.length).toBe(0)
        })

        it('should not accumulate buffers across multiple recording sessions', () => {
            const emit = (event: eventWithTime) => {
                events.push(event)
            }

            // First recording session
            const stop1 = record({ emit })
            const buffersAfterFirst = mutationBuffers.length
            expect(buffersAfterFirst).toBeGreaterThan(0)
            stop1?.()
            expect(mutationBuffers.length).toBe(0)

            // Second recording session
            const stop2 = record({ emit })
            const buffersAfterSecond = mutationBuffers.length
            expect(buffersAfterSecond).toBe(buffersAfterFirst)
            stop2?.()
            expect(mutationBuffers.length).toBe(0)

            // Third recording session
            const stop3 = record({ emit })
            const buffersAfterThird = mutationBuffers.length
            expect(buffersAfterThird).toBe(buffersAfterFirst)
            stop3?.()
            expect(mutationBuffers.length).toBe(0)
        })

        it('should clear buffers even if recording had mutations', async () => {
            const emit = (event: eventWithTime) => {
                events.push(event)
            }

            const stopRecording = record({ emit })

            // Trigger some DOM mutations
            const div = document.createElement('div')
            div.textContent = 'Test content'
            document.body.appendChild(div)

            // Wait for mutations to be processed
            await new Promise((resolve) => setTimeout(resolve, 10))

            expect(mutationBuffers.length).toBeGreaterThan(0)

            // Stop recording
            stopRecording?.()

            // Verify buffers are cleared
            expect(mutationBuffers.length).toBe(0)
        })
    })

    describe('IframeManager cleanup', () => {
        it('should remove window message listener when recording stops', () => {
            const emit = (event: eventWithTime) => {
                events.push(event)
            }

            const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
            const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

            // Start recording with cross-origin iframe support
            const stopRecording = record({
                emit,
                recordCrossOriginIframes: true,
            })

            // Verify message listener was added
            expect(addEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function))

            const messageHandler = addEventListenerSpy.mock.calls.find((call) => call[0] === 'message')?.[1]

            // Stop recording
            stopRecording?.()

            // Verify message listener was removed with the same handler
            expect(removeEventListenerSpy).toHaveBeenCalledWith('message', messageHandler)

            addEventListenerSpy.mockRestore()
            removeEventListenerSpy.mockRestore()
        })

        it('should not accumulate message listeners across multiple sessions', () => {
            const emit = (event: eventWithTime) => {
                events.push(event)
            }

            const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
            const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

            // First session
            const stop1 = record({ emit, recordCrossOriginIframes: true })
            const addCallsAfterFirst = addEventListenerSpy.mock.calls.filter((call) => call[0] === 'message').length
            stop1?.()
            const removeCallsAfterFirst = removeEventListenerSpy.mock.calls.filter(
                (call) => call[0] === 'message'
            ).length

            expect(removeCallsAfterFirst).toBe(addCallsAfterFirst)

            // Second session
            const stop2 = record({ emit, recordCrossOriginIframes: true })
            const addCallsAfterSecond = addEventListenerSpy.mock.calls.filter((call) => call[0] === 'message').length
            stop2?.()
            const removeCallsAfterSecond = removeEventListenerSpy.mock.calls.filter(
                (call) => call[0] === 'message'
            ).length

            expect(removeCallsAfterSecond).toBe(addCallsAfterSecond)

            addEventListenerSpy.mockRestore()
            removeEventListenerSpy.mockRestore()
        })

        it('should not add message listener when recordCrossOriginIframes is false', () => {
            const emit = (event: eventWithTime) => {
                events.push(event)
            }

            const addEventListenerSpy = vi.spyOn(window, 'addEventListener')

            const stopRecording = record({
                emit,
                recordCrossOriginIframes: false,
            })

            // Verify no message listener was added
            const messageListenerCalls = addEventListenerSpy.mock.calls.filter((call) => call[0] === 'message')
            expect(messageListenerCalls.length).toBe(0)

            stopRecording?.()

            addEventListenerSpy.mockRestore()
        })
    })
})
