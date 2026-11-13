// @vitest-environment node

import { buildSync } from 'esbuild'
import fs from 'fs'
import path from 'path'

describe('Published extension bundle tree shaking', () => {
    const bundleExtensions = (extensions: string[]): string => {
        const { outputFiles } = buildSync({
            stdin: {
                contents: `
import { ${extensions.join(', ')} } from './extension-bundles.js'
export const extensionClasses = { ${extensions.map((name) => `...${name}`).join(', ')} }
`,
                resolveDir: path.resolve(__dirname, '../../../dist'),
            },
            bundle: true,
            format: 'esm',
            minify: true,
            write: false,
        })
        return outputFiles[0].text
    }

    it('omits unused extension loggers from a tracing-only bundle', () => {
        const code = bundleExtensions(['TracingExtensions'])
        expect(code).toContain('[TracingHeaders]')
        for (const prefix of [
            '[AutoCapture]',
            '[SessionRecording]',
            '[Web Vitals]',
            '[Dead Clicks]',
            '[ExceptionAutocapture]',
            '[Heatmaps]',
            '[Product Tours]',
            '[SiteApps]',
            '[Surveys]',
            '[Toolbar]',
            '[FeatureFlags]',
            '[Error tracking]',
            '[Conversations]',
            '[NetworkMetrics]',
            '[RemoteConfig]',
        ]) {
            expect(code.includes(prefix), prefix).toBe(false)
        }
    })

    it.each([
        ['browser detection', 'Windows NT'],
        ['campaign parameters', 'utm_source'],
        ['log severities', '"TRACE"'],
        ['autocapture ignore lists', 'previous'],
        ['autocapture credit-card patterns', '4[0-9]{12}'],
        ['autocapture SSN patterns', '(?!000|666)'],
        ['privacy URL patterns', '{0,63}'],
    ])('omits unused %s from a tracing-only bundle', (_name, marker) => {
        const code = bundleExtensions(['TracingExtensions'])
        expect(code.includes(marker)).toBe(false)
    })

    it.each([
        ['LogsExtensions', 'Windows NT'],
        ['LogsExtensions', '"TRACE"'],
        ['AnalyticsExtensions', 'previous'],
        ['AnalyticsExtensions', '4[0-9]{12}'],
        ['ExperimentsExtensions', 'utm_source'],
        ['WebMCPExtensions', '{0,63}'],
        ['SessionReplayExtensions', '[SessionRecording]'],
        ['AnalyticsExtensions', '[Heatmaps]'],
    ])('retains helpers needed by %s (%s)', (extension, marker) => {
        const code = bundleExtensions([extension])
        expect(code.includes(marker)).toBe(true)
    })

    it('preserves DOMPurify source locations through its tree-shaking wrapper', () => {
        const map = JSON.parse(
            fs.readFileSync(path.resolve(__dirname, '../../../dist/extension-bundles.js.map'), 'utf8')
        )
        expect(map.sources.some((source: string) => source.endsWith('/dompurify/dist/purify.es.mjs'))).toBe(true)
    })

    it.each([
        { extensions: ['AnalyticsExtensions', 'LogsExtensions'] },
        {
            extensions: ['AnalyticsExtensions', 'ErrorTrackingExtensions', 'LogsExtensions', 'SessionReplayExtensions'],
        },
    ])('removes unselected features when importing $extensions', ({ extensions }) => {
        const code = bundleExtensions(extensions)

        expect(code.includes('DOMPurify')).toBe(false)
        expect(code.includes('"__posthog"')).toBe(false)
        expect(code).toContain('$autocapture')
        expect(code).not.toContain('getActiveProductTours')
        expect(code).not.toContain('getActiveMatchingSurveys')
        expect(code).not.toContain('$feature_flag_called')
        if (!extensions.includes('SessionReplayExtensions')) {
            expect(code).not.toContain('[SessionRecording] started without valid sessionManager')
        }
    })
})
