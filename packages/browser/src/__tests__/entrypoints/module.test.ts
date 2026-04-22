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
