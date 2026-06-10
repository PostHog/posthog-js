import type { OutputOptions } from 'rollup'
import posthogRollupPlugin from './index.js'

const options = {
    personalApiKey: 'phx_test',
    projectId: '1',
}

type TestPlugin = {
    config: () => { build: { sourcemap: 'hidden' | true } } | undefined
    outputOptions: {
        handler: (options: OutputOptions) => OutputOptions
    }
}

const testPlugin = (...args: Parameters<typeof posthogRollupPlugin>): TestPlugin =>
    posthogRollupPlugin(...args) as unknown as TestPlugin

describe('posthogRollupPlugin', () => {
    it('enables hidden sourcemaps in Vite and Rollup when maps are deleted after upload', () => {
        const plugin = testPlugin(options)

        expect(plugin.config()).toEqual({ build: { sourcemap: 'hidden' } })
        expect(plugin.outputOptions.handler({} as OutputOptions)).toEqual({ sourcemap: 'hidden' })
    })

    it('enables visible sourcemaps when maps are kept after upload', () => {
        const plugin = testPlugin({
            ...options,
            sourcemaps: { deleteAfterUpload: false },
        })

        expect(plugin.config()).toEqual({ build: { sourcemap: true } })
        expect(plugin.outputOptions.handler({} as OutputOptions)).toEqual({ sourcemap: true })
    })

    it('leaves sourcemap settings alone when disabled', () => {
        const plugin = testPlugin({
            personalApiKey: '',
            sourcemaps: { enabled: false },
        })
        const outputOptions = { sourcemap: false } as OutputOptions

        expect(plugin.config()).toBeUndefined()
        expect(plugin.outputOptions.handler(outputOptions)).toBe(outputOptions)
    })
})
