import fs from 'fs'
import path from 'path'
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

describe('Full no-external bundles', () => {
    it.each([
        ['array', arrayFullNoExternalJs, arrayNoExternalJs],
        ['module', moduleFullNoExternalJs, moduleNoExternalJs],
    ])(
        '%s full no-external bundle should eagerly bootstrap session recording',
        (_name, fullNoExternalBundle, noExternalBundle) => {
            expect(fullNoExternalBundle).toMatch(/__PosthogExtensions__\.initSessionRecording\s*=/)
            expect(noExternalBundle).not.toMatch(/__PosthogExtensions__\.initSessionRecording\s*=/)
        }
    )
})
