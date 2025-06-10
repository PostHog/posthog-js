import fs from 'fs'
import path from 'path'

describe('sanity check that rrwebs obfuscated JS is not present', () => {
    const arrayFullNoExternalJs = fs.readFileSync(
        path.join(__dirname, '../../../dist/array.full.no-external.js'),
        'utf-8'
    )
    const moduleFullNoExternalJs = fs.readFileSync(
        path.join(__dirname, '../../../dist/module.full.no-external.js'),
        'utf-8'
    )
    const code =
        'KGZ1bmN0aW9uKCkgewogICJ1c2Ugc3RyaWN0IjsKICB2YXIgY2hhcnMgPSAiQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyI7CiAgdmFyIGxvb2t1cCA9IHR5cGVvZiBVaW50OEFycmF5ID09PSAidW5kZWZpbmVkIiA'

    it('should not contain the obfuscated code snippet', () => {
        expect(arrayFullNoExternalJs).not.toContain(code)
        expect(moduleFullNoExternalJs).not.toContain(code)
    })
})
