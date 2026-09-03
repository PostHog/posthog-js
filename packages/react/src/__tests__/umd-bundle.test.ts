import fs from 'node:fs'
import vm from 'node:vm'
import React from 'react'
import { renderHook } from '@testing-library/react'

const mockPostHogInstance = {
    capture: vi.fn(),
    isFeatureEnabled: vi.fn(),
}

describe('UMD bundle', () => {
    it('unwraps the posthog-js CommonJS namespace for the default instance', () => {
        const module = { exports: {} as Record<string, unknown> }
        const bundle = fs.readFileSync('dist/umd/index.js', 'utf8')

        vm.runInNewContext(bundle, {
            exports: module.exports,
            module,
            require: (id: string) => {
                if (id === 'posthog-js') {
                    return { default: mockPostHogInstance, posthog: mockPostHogInstance }
                }
                if (id === 'react') {
                    return React
                }
                throw new Error(`Unexpected UMD dependency: ${id}`)
            },
        })

        const { usePostHog } = module.exports as { usePostHog: () => typeof mockPostHogInstance }
        const { result } = renderHook(() => usePostHog())

        expect(result.current).toBe(mockPostHogInstance)
        expect(result.current.capture).toBe(mockPostHogInstance.capture)
        expect(result.current.isFeatureEnabled).toBe(mockPostHogInstance.isFeatureEnabled)
    })
})
