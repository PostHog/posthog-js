import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const packageRoot = join(__dirname, '..', '..')
const readJson = (path: string): any => JSON.parse(readFileSync(join(packageRoot, path), 'utf8'))

// Metro without package exports (React Native < 0.79 by default) resolves `@posthog/core/surveys`
// as a folder, so the stub must point at the same files as the `./surveys` export.
describe('subpath stubs', () => {
  it('surveys/package.json matches the ./surveys export', () => {
    const exported = readJson('package.json').exports['./surveys']
    const stub = readJson('surveys/package.json')

    expect(join('surveys', stub.main)).toBe(join(exported.require))
    expect(join('surveys', stub.module)).toBe(join(exported.import))
    expect(join('surveys', stub.types)).toBe(join(exported.types))
  })

  it('ships the surveys stub', () => {
    expect(readJson('package.json').files).toContain('surveys')
  })
})
