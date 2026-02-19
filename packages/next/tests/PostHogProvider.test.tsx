import React from 'react'
import { render, screen } from '@testing-library/react'
import { PostHogProvider } from '../src/app/PostHogProvider'

// Mock ClientPostHogProvider
const mockClientProvider = jest.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="client-provider">{children}</div>
))
jest.mock('../src/client/ClientPostHogProvider', () => ({
    ClientPostHogProvider: (props: any) => mockClientProvider(props),
}))

// Mock next/headers
jest.mock('next/headers', () => ({
    cookies: jest.fn(),
}))

// Mock PostHogServer
const mockGetAllFlags = jest.fn()
const mockGetAllFlagsAndPayloads = jest.fn()
const mockGetDistinctId = jest.fn()

jest.mock('../src/server/PostHogServer', () => ({
    PostHogServer: jest.fn().mockImplementation(() => ({
        getClient: jest.fn().mockReturnValue({
            getAllFlags: mockGetAllFlags,
            getAllFlagsAndPayloads: mockGetAllFlagsAndPayloads,
            getDistinctId: mockGetDistinctId,
        }),
    })),
}))

describe('PostHogProvider', () => {
    const originalEnv = process.env

    beforeEach(() => {
        mockClientProvider.mockClear()
        process.env = { ...originalEnv }
    })

    afterAll(() => {
        process.env = originalEnv
    })

    it('renders children via ClientPostHogProvider', async () => {
        const element = await PostHogProvider({
            apiKey: 'phc_test123',
            children: <div data-testid="child">Hello</div>,
        })
        render(element)
        expect(screen.getByTestId('child')).toBeInTheDocument()
    })

    it('passes apiKey and options to ClientPostHogProvider', async () => {
        const options = { api_host: 'https://custom.posthog.com' }
        const element = await PostHogProvider({
            apiKey: 'phc_test123',
            options,
            children: <div>Child</div>,
        })
        render(element)
        expect(mockClientProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                apiKey: 'phc_test123',
                options: expect.objectContaining({ api_host: 'https://custom.posthog.com' }),
            })
        )
    })

    it('does not pass bootstrap when bootstrapFlags is not set', async () => {
        const element = await PostHogProvider({
            apiKey: 'phc_test123',
            children: <div>Child</div>,
        })
        render(element)
        expect(mockClientProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                bootstrap: undefined,
            })
        )
    })

    it('resolves synchronously when bootstrapFlags is off (static-safe)', async () => {
        let settled = false
        PostHogProvider({
            apiKey: 'phc_test123',
            children: <div>Child</div>,
        }).then(() => {
            settled = true
        })

        // Flush one microtick. An async function that never awaits
        // returns an already-resolved promise, so the .then() callback
        // runs in the next microtick. If any real async work happened,
        // the promise would still be pending here.
        await Promise.resolve()
        expect(settled).toBe(true)
    })

    it('throws when apiKey is empty and env var is not set', async () => {
        delete process.env.NEXT_PUBLIC_POSTHOG_KEY
        await expect(
            PostHogProvider({
                apiKey: '',
                children: <div>Child</div>,
            })
        ).rejects.toThrow('[PostHog Next.js] apiKey is required')
    })

    it('warns when apiKey does not start with phc_', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
        const element = await PostHogProvider({
            apiKey: 'not_a_valid_key',
            children: <div>Child</div>,
        })
        render(element)
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('does not start with "phc_"')
        )
        warnSpy.mockRestore()
    })

    it('does not warn when apiKey starts with phc_', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
        const element = await PostHogProvider({
            apiKey: 'phc_test123',
            children: <div>Child</div>,
        })
        render(element)
        expect(warnSpy).not.toHaveBeenCalled()
        warnSpy.mockRestore()
    })

    describe('environment variable defaults', () => {
        it('reads apiKey from NEXT_PUBLIC_POSTHOG_KEY when prop is omitted', async () => {
            process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_from_env'
            const element = await PostHogProvider({
                children: <div>Child</div>,
            })
            render(element)
            expect(mockClientProvider).toHaveBeenCalledWith(
                expect.objectContaining({ apiKey: 'phc_from_env' })
            )
        })

        it('prefers apiKey prop over env var', async () => {
            process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_from_env'
            const element = await PostHogProvider({
                apiKey: 'phc_from_prop',
                children: <div>Child</div>,
            })
            render(element)
            expect(mockClientProvider).toHaveBeenCalledWith(
                expect.objectContaining({ apiKey: 'phc_from_prop' })
            )
        })

        it('reads api_host from NEXT_PUBLIC_POSTHOG_HOST when not in options', async () => {
            process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.posthog.com'
            const element = await PostHogProvider({
                apiKey: 'phc_test123',
                children: <div>Child</div>,
            })
            render(element)
            expect(mockClientProvider).toHaveBeenCalledWith(
                expect.objectContaining({
                    options: expect.objectContaining({ api_host: 'https://eu.posthog.com' }),
                })
            )
        })

        it('prefers options.api_host over env var', async () => {
            process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.posthog.com'
            const element = await PostHogProvider({
                apiKey: 'phc_test123',
                options: { api_host: 'https://custom.posthog.com' },
                children: <div>Child</div>,
            })
            render(element)
            expect(mockClientProvider).toHaveBeenCalledWith(
                expect.objectContaining({
                    options: expect.objectContaining({ api_host: 'https://custom.posthog.com' }),
                })
            )
        })
    })

    describe('with bootstrapFlags', () => {
        const identifiedCookieValue = JSON.stringify({ distinct_id: 'user_abc', $device_id: 'device_xyz', $user_state: 'identified' })
        const anonymousCookieValue = JSON.stringify({ distinct_id: 'device_xyz', $device_id: 'device_xyz' })

        function setupCookieMock(cookieValue: string) {
            const { cookies } = require('next/headers')
            cookies.mockResolvedValue({
                get: jest.fn((name: string) => {
                    if (name === 'ph_phc_test123_posthog') {
                        return { name, value: cookieValue }
                    }
                    return undefined
                }),
            })
        }

        beforeEach(() => {
            mockGetAllFlags.mockReset()
            mockGetAllFlagsAndPayloads.mockReset()
            mockGetDistinctId.mockReset()

            mockGetDistinctId.mockReturnValue('user_abc')
            mockGetAllFlags.mockResolvedValue({ 'flag-1': true, 'flag-2': 'variant-a' })
            mockGetAllFlagsAndPayloads.mockResolvedValue({
                featureFlags: { 'flag-1': true },
                featureFlagPayloads: { 'flag-1': { color: 'blue' } },
            })

            setupCookieMock(identifiedCookieValue)
        })

        it('evaluates all flags when bootstrapFlags is true', async () => {
            const element = await PostHogProvider({
                apiKey: 'phc_test123',
                bootstrapFlags: true,
                children: <div>Child</div>,
            })
            render(element)

            expect(mockGetAllFlags).toHaveBeenCalledWith(undefined)
            expect(mockClientProvider).toHaveBeenCalledWith(
                expect.objectContaining({
                    bootstrap: expect.objectContaining({
                        distinctID: 'user_abc',
                        featureFlags: { 'flag-1': true, 'flag-2': 'variant-a' },
                    }),
                })
            )
        })

        it('evaluates specific flags when flagKeys provided', async () => {
            const element = await PostHogProvider({
                apiKey: 'phc_test123',
                bootstrapFlags: { flags: ['flag-1'] },
                children: <div>Child</div>,
            })
            render(element)

            expect(mockGetAllFlags).toHaveBeenCalledWith(['flag-1'])
        })

        it('includes payloads when payloads option is true', async () => {
            const element = await PostHogProvider({
                apiKey: 'phc_test123',
                bootstrapFlags: { payloads: true },
                children: <div>Child</div>,
            })
            render(element)

            expect(mockGetAllFlagsAndPayloads).toHaveBeenCalledWith(undefined)
            expect(mockGetAllFlags).not.toHaveBeenCalled()
            expect(mockClientProvider).toHaveBeenCalledWith(
                expect.objectContaining({
                    bootstrap: expect.objectContaining({
                        featureFlags: { 'flag-1': true },
                        featureFlagPayloads: { 'flag-1': { color: 'blue' } },
                    }),
                })
            )
        })

        it('sets isIdentifiedID to true when distinct_id differs from device_id', async () => {
            setupCookieMock(identifiedCookieValue)

            const element = await PostHogProvider({
                apiKey: 'phc_test123',
                bootstrapFlags: true,
                children: <div>Child</div>,
            })
            render(element)

            expect(mockClientProvider).toHaveBeenCalledWith(
                expect.objectContaining({
                    bootstrap: expect.objectContaining({
                        isIdentifiedID: true,
                    }),
                })
            )
        })

        it('renders without bootstrap when flag evaluation fails', async () => {
            mockGetAllFlags.mockRejectedValue(new Error('network timeout'))
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

            const element = await PostHogProvider({
                apiKey: 'phc_test123',
                bootstrapFlags: true,
                children: <div>Child</div>,
            })
            render(element)

            expect(mockClientProvider).toHaveBeenCalledWith(
                expect.objectContaining({
                    bootstrap: undefined,
                })
            )
            expect(warnSpy).toHaveBeenCalledWith(
                '[PostHog Next.js] Failed to evaluate bootstrap flags:',
                expect.any(Error)
            )
            warnSpy.mockRestore()
        })

        it('sets isIdentifiedID to false when distinct_id equals device_id', async () => {
            setupCookieMock(anonymousCookieValue)
            mockGetDistinctId.mockReturnValue('device_xyz')

            const element = await PostHogProvider({
                apiKey: 'phc_test123',
                bootstrapFlags: true,
                children: <div>Child</div>,
            })
            render(element)

            expect(mockClientProvider).toHaveBeenCalledWith(
                expect.objectContaining({
                    bootstrap: expect.objectContaining({
                        isIdentifiedID: false,
                    }),
                })
            )
        })
    })
})
