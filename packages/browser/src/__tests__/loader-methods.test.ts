// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { rolldown } from 'rolldown'
import { getLoaderMethods, loaderMethods } from '../../scripts/loader-methods.mjs'

describe('loader method generation', () => {
    it('includes public callable API members and nested people methods without properties or duplicate overloads', () => {
        const source = `
            class Other { unrelated() {} }
            export class PostHog {
                constructor() {}
                init(token: string) {}
                capture(event: string): void
                capture(event: string, properties: object): void
                capture(event: string, properties?: object) {}
                captureTraceMetric(trace: string, metric: string, value: number) {}
                onSurveysLoaded(callback: () => void) {}
                "stringMethod"() {}
                private hidden() {}
                protected protectedMethod() {}
                static staticMethod() {}
                _internal() {}
                push() {}
                toString() {}
                get flagsLoaded() { return true }
                readonly version = 'test'
                people: {
                    set: (properties: object) => void
                    set_once(properties: object): void
                    readonly label: string
                }
            }
        `
        expect(getLoaderMethods(source)).toEqual([
            'capture',
            'captureTraceMetric',
            'init',
            'onSurveysLoaded',
            'people.set',
            'people.set_once',
            'stringMethod',
        ])
    })

    it('fails the build instead of silently generating an empty API when the class is missing', () => {
        expect(() => getLoaderMethods('export class Other { capture() {} }')).toThrow('PostHog class not found')
    })

    it('embeds newly added API methods and registers the SDK source for watch rebuilds', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-loader-methods-'))
        const api = path.join(directory, 'posthog.ts')
        const entry = path.join(directory, 'entry.mjs')
        fs.writeFileSync(entry, "export { default } from 'virtual:posthog-loader-methods'")
        const plugin = loaderMethods(api)

        try {
            for (const expected of ['capture', 'capture newMethod']) {
                const declarations = expected
                    .split(' ')
                    .map((name) => `${name}() {}`)
                    .join('\n')
                fs.writeFileSync(api, `export class PostHog { ${declarations} }`)
                const bundle = await rolldown({ input: entry, plugins: [plugin] })
                try {
                    const { output } = await bundle.generate({ format: 'cjs', exports: 'named' })
                    const exports: { default?: string } = {}
                    runInNewContext(output[0].code, { exports })
                    expect(exports.default).toBe(expected)
                    expect(await bundle.watchFiles).toContain(api)
                } finally {
                    await bundle.close()
                }
            }
        } finally {
            fs.rmSync(directory, { recursive: true, force: true })
        }
    })
})
