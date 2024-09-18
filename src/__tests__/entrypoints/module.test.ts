import fs from 'fs'
import path from 'path'
// Sanity checks to check the built code does not contain any script loaders

describe('Array entrypoint', () => {
    const arrayJs = fs.readFileSync(path.join(__dirname, '../../../dist/array.js'), 'utf-8')
    const arrayFullJs = fs.readFileSync(path.join(__dirname, '../../../dist/array.full.js'), 'utf-8')
    const arrayNoExternalJs = fs.readFileSync(path.join(__dirname, '../../../dist/array.no-external.js'), 'utf-8')
    const arrayFullNoExternalJs = fs.readFileSync(
        path.join(__dirname, '../../../dist/array.full.no-external.js'),
        'utf-8'
    )

    it('should not contain any script loaders', () => {
        expect(arrayJs).toContain('loadExternalDependency=')
        expect(arrayFullJs).toContain('loadExternalDependency=')
        expect(arrayNoExternalJs).not.toContain('loadExternalDependency=')
        expect(arrayFullNoExternalJs).not.toContain('loadExternalDependency=')
    })
})

describe('Module entrypoint', () => {
    const moduleJs = fs.readFileSync(path.join(__dirname, '../../../dist/module.js'), 'utf-8')
    const moduleFullJs = fs.readFileSync(path.join(__dirname, '../../../dist/module.full.js'), 'utf-8')
    const moduleNoExternalJs = fs.readFileSync(path.join(__dirname, '../../../dist/module.no-external.js'), 'utf-8')
    const moduleFullNoExternalJs = fs.readFileSync(
        path.join(__dirname, '../../../dist/module.full.no-external.js'),
        'utf-8'
    )

    it('should not contain any script loaders', () => {
        // For the module loader, the code isn't minified
        expect(moduleJs).toContain('loadExternalDependency=')
        expect(moduleFullJs).toContain('loadExternalDependency=')
        expect(moduleNoExternalJs).not.toContain('loadExternalDependency=')
        expect(moduleFullNoExternalJs).not.toContain('loadExternalDependency=')
    })
})
