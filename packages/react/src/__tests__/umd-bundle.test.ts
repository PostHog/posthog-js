import { renderHook } from '@testing-library/react'

const mockPostHogInstance = {
    capture: jest.fn(),
    isFeatureEnabled: jest.fn(),
}

jest.mock('posthog-js', () => ({
    default: mockPostHogInstance,
    posthog: mockPostHogInstance,
}))

describe('UMD bundle', () => {
    it('unwraps the posthog-js CommonJS namespace for the default instance', async () => {
        const { usePostHog } = await import('../../dist/umd/index.js')

        const { result } = renderHook(() => usePostHog())

        expect(result.current).toBe(mockPostHogInstance)
        expect(result.current.capture).toBe(mockPostHogInstance.capture)
        expect(result.current.isFeatureEnabled).toBe(mockPostHogInstance.isFeatureEnabled)
    })
})
