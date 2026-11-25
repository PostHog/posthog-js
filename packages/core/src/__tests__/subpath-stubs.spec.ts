import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const packageRoot = join(__dirname, '..', '..')
const readJson = (path: string): any => JSON.parse(readFileSync(join(packageRoot, path), 'utf8'))

// Metro without package exports (React Native < 0.79 by default) resolves `@posthog/core/<subpath>`
// as a folder, so each stub must point at the same files as its export.
describe.each(['surveys', 'capture-v1'])('%s subpath stub', (subpath) => {
  it(`${subpath}/package.json matches the ./${subpath} export`, () => {
    const exported = readJson('package.json').exports[`./${subpath}`]
    const stub = readJson(`${subpath}/package.json`)

    expect(join(subpath, stub.main)).toBe(join(exported.require))
    expect(join(subpath, stub.module)).toBe(join(exported.import))
    expect(join(subpath, stub.types)).toBe(join(exported.types))
  })

  it(`ships the ${subpath} stub`, () => {
    expect(readJson('package.json').files).toContain(subpath)
  })
})
