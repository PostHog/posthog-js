import { renderHook } from '@testing-library/react'

const mockPostHogInstance = {
    capture: vi.fn(),
    isFeatureEnabled: vi.fn(),
}

vi.mock('posthog-js', () => ({
    default: mockPostHogInstance,
    posthog: mockPostHogInstance,
}))

describe('UMD bundle', () => {
    it('unwraps the posthog-js CommonJS namespace for the default instance', () => {
        const { usePostHog } = vi.requireActual('../../dist/umd/index.js')

        const { result } = renderHook(() => usePostHog())

        expect(result.current).toBe(mockPostHogInstance)
        expect(result.current.capture).toBe(mockPostHogInstance.capture)
        expect(result.current.isFeatureEnabled).toBe(mockPostHogInstance.isFeatureEnabled)
    })
})
