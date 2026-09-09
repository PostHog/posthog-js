import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import * as ts from 'typescript'
// Sanity checks to check the built code does not contain any script loaders

const arrayJs = fs.readFileSync(path.join(__dirname, '../../../dist/array.js'), 'utf-8')
const arrayFullJs = fs.readFileSync(path.join(__dirname, '../../../dist/array.full.js'), 'utf-8')
const arrayNoExternalJs = fs.readFileSync(path.join(__dirname, '../../../dist/array.no-external.js'), 'utf-8')
const arrayFullNoExternalJs = fs.readFileSync(path.join(__dirname, '../../../dist/array.full.no-external.js'), 'utf-8')

const moduleJs = fs.readFileSync(path.join(__dirname, '../../../dist/module.js'), 'utf-8')
const moduleFullJs = fs.readFileSync(path.join(__dirname, '../../../dist/module.full.js'), 'utf-8')
const moduleNoExternalJs = fs.readFileSync(path.join(__dirname, '../../../dist/module.no-external.js'), 'utf-8')
const moduleFullNoExternalJs = fs.readFileSync(
    path.join(__dirname, '../../../dist/module.full.no-external.js'),
    'utf-8'
)
const moduleSlimDts = fs.readFileSync(path.join(__dirname, '../../../dist/module.slim.d.ts'), 'utf-8')
const extensionBundlesDts = fs.readFileSync(path.join(__dirname, '../../../dist/extension-bundles.d.ts'), 'utf-8')
const webVitalsSoftNavsJs = fs.readFileSync(path.join(__dirname, '../../../dist/web-vitals-soft-navs.js'), 'utf-8')

const evaluateBundle = (bundle: string, supportsSoftNavigations = false) => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const frameWindow = iframe.contentWindow as typeof window & {
        __PosthogExtensions__?: {
            postHogWebVitalsCallbacksByFlavor?: Record<
                string,
                { onLCP: (callback: () => void, options: object) => void }
            >
        }
        __observedEntryTypes?: string[]
        PerformanceSoftNavigation?: { prototype: { getLargestInteractionContentfulPaint: () => void } }
    }
    frameWindow.__observedEntryTypes = []
    class MockPerformanceObserver {
        static supportedEntryTypes = supportsSoftNavigations
            ? ['largest-contentful-paint', 'interaction-contentful-paint', 'soft-navigation']
            : ['largest-contentful-paint']

        observe(options: { type: string }) {
            frameWindow.__observedEntryTypes!.push(options.type)
        }

        disconnect() {}
        takeRecords() {
            return []
        }
    }
    Object.defineProperty(frameWindow, 'PerformanceObserver', { value: MockPerformanceObserver, configurable: true })
    Object.defineProperty(frameWindow.performance, 'getEntriesByType', { value: () => [], configurable: true })
    if (supportsSoftNavigations) {
        class MockPerformanceSoftNavigation {
            getLargestInteractionContentfulPaint() {}
        }
        Object.defineProperty(frameWindow, 'PerformanceSoftNavigation', {
            value: MockPerformanceSoftNavigation,
            configurable: true,
        })
    }
    frameWindow.eval(bundle)
    return { frameWindow, iframe }
}

describe('Array entrypoint', () => {
    it('should not contain any script loaders', () => {
        expect(arrayJs).toContain('__PosthogExtensions__.loadExternalDependency=')
        expect(arrayFullJs).toContain('__PosthogExtensions__.loadExternalDependency=')
        expect(arrayNoExternalJs).not.toContain('__PosthogExtensions__.loadExternalDependency=')
        expect(arrayFullNoExternalJs).not.toContain('__PosthogExtensions__.loadExternalDependency=')
    })
})

describe('Module entrypoint', () => {
    it('should not contain any script loaders', () => {
        // For the module loader, the code isn't minified
        expect(moduleJs).toContain('__PosthogExtensions__.loadExternalDependency=')
        expect(moduleFullJs).toContain('__PosthogExtensions__.loadExternalDependency=')
        expect(moduleNoExternalJs).not.toContain('__PosthogExtensions__.loadExternalDependency=')
        expect(moduleFullNoExternalJs).not.toContain('__PosthogExtensions__.loadExternalDependency=')
    })

    it('ships the package module as unambiguous ESM while preserving the legacy .js entrypoint', () => {
        const packageRoot = path.resolve(__dirname, '../../..')
        const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf-8'))
        const modulePath = path.join(packageRoot, packageJson.module)

        expect(packageJson.main).toBe('dist/main.js')
        expect(packageJson.module).toBe('dist/module.mjs')
        expect(fs.existsSync(path.join(packageRoot, 'dist/module.js'))).toBe(true)
        expect(fs.existsSync(modulePath)).toBe(true)
        expect(fs.readFileSync(modulePath, 'utf-8').replace('module.mjs.map', 'module.js.map') === moduleJs).toBe(true)

        execFileSync(
            process.execPath,
            ['--input-type=module', '--eval', `await import(${JSON.stringify(pathToFileURL(modulePath).href)})`],
            { stdio: 'pipe' }
        )
    })
})

describe('Web vitals bundles', () => {
    afterEach(() => {
        document.querySelectorAll('iframe').forEach((iframe) => iframe.remove())
    })

    it.each([
        ['array.full', arrayFullJs],
        ['array.full.no-external', arrayFullNoExternalJs],
    ])('%s includes every callback flavor', (_name, bundle) => {
        const { frameWindow } = evaluateBundle(bundle)

        expect(Object.keys(frameWindow.__PosthogExtensions__?.postHogWebVitalsCallbacksByFlavor || {})).toEqual([
            'web-vitals-with-attribution-soft-navs',
            'web-vitals-soft-navs',
            'web-vitals-with-attribution',
            'web-vitals',
        ])
    })

    it.each([
        [false, ['largest-contentful-paint']],
        [true, ['largest-contentful-paint', 'interaction-contentful-paint', 'soft-navigation']],
    ])('soft-nav entrypoint falls back when browser support is %p', (supportsSoftNavigations, expectedEntryTypes) => {
        const { frameWindow } = evaluateBundle(webVitalsSoftNavsJs, supportsSoftNavigations)

        frameWindow.__PosthogExtensions__?.postHogWebVitalsCallbacksByFlavor?.['web-vitals-soft-navs'].onLCP(() => {}, {
            reportSoftNavs: true,
        })

        expect(frameWindow.__observedEntryTypes).toEqual(expectedEntryTypes)
    })
})

describe('Slim runtime bundles', () => {
    it('does not retain request transport or compression code in the extension bundle', () => {
        const map = JSON.parse(
            fs.readFileSync(path.resolve(__dirname, '../../../dist/extension-bundles.js.map'), 'utf-8')
        )
        expect(map.sources.some((source: string) => /fflate|\/gzip\.mjs$|\/encode-utils\.mjs$/.test(source))).toBe(
            false
        )
        expect(map.names).not.toContain('AVAILABLE_TRANSPORTS')
    })
})

describe('Slim module declarations', () => {
    it('share nominal types between extension bundles and both slim entrypoints', () => {
        expect(extensionBundlesDts).toMatch(/from ['"]\.\/module\.slim['"]/)
        expect(moduleSlimDts).toMatch(/from ['"]\.\/module\.slim\.no-external['"]/)
        expect(moduleSlimDts).not.toContain('declare class PostHog')

        const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-slim-types-'))
        const fixturePath = path.join(fixtureDirectory, 'index.ts')
        const distPath = path.resolve(__dirname, '../../../dist').replaceAll('\\', '/')
        fs.writeFileSync(
            fixturePath,
            `
import { AnalyticsExtensions, ErrorTrackingExtensions, SessionReplayExtensions } from '${distPath}/extension-bundles'
import posthog from '${distPath}/module.slim'
import type { PostHog, PostHogConfig } from '${distPath}/module.slim.no-external'

const instance: PostHog = posthog
void instance

const extensionClasses = {
    ...SessionReplayExtensions,
    ...AnalyticsExtensions,
    ...ErrorTrackingExtensions,
} satisfies NonNullable<PostHogConfig['__extensionClasses']>
void extensionClasses
`
        )

        try {
            const program = ts.createProgram([fixturePath], {
                exactOptionalPropertyTypes: true,
                module: ts.ModuleKind.ESNext,
                moduleResolution: ts.ModuleResolutionKind.Bundler,
                noEmit: true,
                skipLibCheck: true,
                strict: true,
                target: ts.ScriptTarget.ESNext,
            })
            const diagnostics = ts.getPreEmitDiagnostics(program)
            expect(
                ts.formatDiagnosticsWithColorAndContext(diagnostics, {
                    getCanonicalFileName: (fileName) => fileName,
                    getCurrentDirectory: () => fixtureDirectory,
                    getNewLine: () => '\n',
                })
            ).toBe('')
        } finally {
            fs.rmSync(fixtureDirectory, { recursive: true })
        }
    })
})

describe('Published entrypoint declarations', () => {
    it('preserves the unbundled declarations previously emitted by the runtime build', () => {
        const libDirectory = path.resolve(__dirname, '../../../lib/src')
        const declarations = fs.readdirSync(libDirectory, { recursive: true }).filter((file) => file.endsWith('.d.ts'))
        expect(declarations.length).toBeGreaterThan(0)
        for (const declaration of declarations) {
            expect(fs.readFileSync(path.resolve(__dirname, '../../../dist/src', declaration), 'utf-8')).toBe(
                fs.readFileSync(path.join(libDirectory, declaration), 'utf-8')
            )
        }
    })

    it('emits exactly one public declaration per source entrypoint without shared chunks', () => {
        const distDirectory = path.resolve(__dirname, '../../../dist')
        const sourceDirectory = path.resolve(__dirname, '../../entrypoints')
        const declarations = fs
            .readdirSync(sourceDirectory)
            .filter((file) => file.endsWith('.ts'))
            .map((file) => file.replace(/(?:\.(?:cjs|es|iife))?\.ts$/, '.d.ts'))

        expect(
            fs
                .readdirSync(distDirectory)
                .filter((file) => file.endsWith('.d.ts'))
                .sort()
        ).toEqual(declarations.sort())
    })

    it('resolves extension declarations from their public package paths', () => {
        const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-extension-types-'))
        const fixturePath = path.join(fixtureDirectory, 'index.ts')
        const distPath = path.resolve(__dirname, '../../../dist').replaceAll('\\', '/')
        const entrypointImports = fs
            .readdirSync(path.resolve(__dirname, '../../entrypoints'))
            .filter((file) => file.endsWith('.ts'))
            .map((file) => file.replace(/(?:\.(?:cjs|es|iife))?\.ts$/, ''))
            .map((entrypoint) => `import 'posthog-js/dist/${entrypoint}'`)
            .join('\n')
        fs.writeFileSync(
            fixturePath,
            `
${entrypointImports}

import posthog from 'posthog-js/dist/module'
import recorder from 'posthog-js/dist/posthog-recorder'
import exceptionAutocapture from 'posthog-js/dist/exception-autocapture'
import webVitals from 'posthog-js/dist/web-vitals'
import DeadClicksAutocapture from 'posthog-js/dist/dead-clicks-autocapture'
import initConversations from 'posthog-js/dist/conversations'
import generateProductTours from 'posthog-js/dist/product-tours'
import generateSurveys from 'posthog-js/dist/surveys'
import { EventType } from 'posthog-js/dist/rrweb-types'

// Earlier bundles expose this enum under an alias; TypeScript compares its local name too.
declare enum EventType$1 {
    DomContentLoaded = 0,
    Load = 1,
    FullSnapshot = 2,
    IncrementalSnapshot = 3,
    Meta = 4,
    Custom = 5,
    Plugin = 6,
}
const legacyEventType: EventType$1 = EventType.IncrementalSnapshot
const currentEventType: EventType = EventType$1.IncrementalSnapshot
void legacyEventType
void currentEventType

new DeadClicksAutocapture(posthog)
initConversations({} as any, posthog)
generateProductTours(posthog, true)
generateSurveys(posthog, true)
void recorder
void exceptionAutocapture
void webVitals
`
        )

        try {
            const program = ts.createProgram([fixturePath], {
                baseUrl: fixtureDirectory,
                module: ts.ModuleKind.ESNext,
                moduleResolution: ts.ModuleResolutionKind.Bundler,
                noEmit: true,
                paths: { 'posthog-js/dist/*': [`${distPath}/*`] },
                strict: true,
                target: ts.ScriptTarget.ESNext,
                types: [],
            })
            const diagnostics = ts.getPreEmitDiagnostics(program)
            expect(
                ts.formatDiagnosticsWithColorAndContext(diagnostics, {
                    getCanonicalFileName: (fileName) => fileName,
                    getCurrentDirectory: () => fixtureDirectory,
                    getNewLine: () => '\n',
                })
            ).toBe('')
        } finally {
            fs.rmSync(fixtureDirectory, { recursive: true })
        }
    })

    it('only declares PostHog in canonical module entrypoints', () => {
        const sourceDirectory = path.resolve(__dirname, '../../entrypoints')
        const declarations = fs
            .readdirSync(sourceDirectory)
            .filter((file) => file.endsWith('.ts'))
            .map((file) => file.replace(/(?:\.(?:cjs|es|iife))?\.ts$/, '.d.ts'))
            .filter((file) => !file.startsWith('module'))

        for (const declarationFile of declarations) {
            const declaration = fs.readFileSync(path.resolve(__dirname, `../../../dist/${declarationFile}`), 'utf-8')
            expect(declaration).not.toMatch(/declare class PostHog\s/)
        }
    })

    it('inlines recorder types that are not production dependencies', () => {
        const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-recorder-types-'))
        const packageDistDirectory = path.join(fixtureDirectory, 'node_modules/posthog-js/dist')
        const fixturePath = path.join(fixtureDirectory, 'index.ts')
        fs.mkdirSync(packageDistDirectory, { recursive: true })
        fs.copyFileSync(
            path.resolve(__dirname, '../../../dist/posthog-recorder.d.ts'),
            path.join(packageDistDirectory, 'posthog-recorder.d.ts')
        )
        fs.writeFileSync(fixturePath, "import recorder from 'posthog-js/dist/posthog-recorder'\nvoid recorder\n")

        try {
            const program = ts.createProgram([fixturePath], {
                module: ts.ModuleKind.ESNext,
                moduleResolution: ts.ModuleResolutionKind.Bundler,
                noEmit: true,
                strict: true,
                target: ts.ScriptTarget.ESNext,
                types: [],
            })
            const diagnostics = ts.getPreEmitDiagnostics(program)
            expect(
                ts.formatDiagnosticsWithColorAndContext(diagnostics, {
                    getCanonicalFileName: (fileName) => fileName,
                    getCurrentDirectory: () => fixtureDirectory,
                    getNewLine: () => '\n',
                })
            ).toBe('')
        } finally {
            fs.rmSync(fixtureDirectory, { recursive: true })
        }
    })
})

describe('Full bundles', () => {
    // session recording only skips its runtime script fetch when *both* `rrweb.record` and
    // `initSessionRecording` are already defined, so the full bundles have to inline both or
    // they still request `/static/lazy-recorder.js` — the exact thing they exist to avoid.
    it.each([
        ['array', arrayFullJs, arrayJs],
        ['module', moduleFullJs, moduleJs],
        ['array no-external', arrayFullNoExternalJs, arrayNoExternalJs],
        ['module no-external', moduleFullNoExternalJs, moduleNoExternalJs],
    ])('%s full bundle should eagerly bootstrap session recording', (_name, fullBundle, nonFullBundle) => {
        expect(fullBundle).toMatch(/__PosthogExtensions__\.rrweb\s*=/)
        expect(fullBundle).toMatch(/__PosthogExtensions__\.initSessionRecording\s*=/)
        expect(nonFullBundle).not.toMatch(/__PosthogExtensions__\.initSessionRecording\s*=/)
    })
})
