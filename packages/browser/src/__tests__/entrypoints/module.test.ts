import fs from 'fs'
import os from 'os'
import path from 'path'
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

describe('Slim module declarations', () => {
    it('share nominal types between extension bundles and both slim entrypoints', () => {
        expect(extensionBundlesDts).toContain("from './module.slim'")
        expect(moduleSlimDts).toContain("from './module.slim.no-external'")
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
