import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const srcDir = join(__dirname, '..', 'src')
const coreDir = join(__dirname, '..', '..', 'core')

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })

// Metro without package exports (React Native < 0.79 by default) can only resolve
// `@posthog/core/<subpath>` through a real `<subpath>/package.json` in @posthog/core.
describe('@posthog/core subpath imports', () => {
  it('each has a resolvable stub in @posthog/core', () => {
    const subpaths = new Set(
      sourceFiles(srcDir).flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(/['"]@posthog\/core\/([\w-]+)['"]/g)].map((match) => match[1])
      )
    )

    expect(subpaths.size).toBeGreaterThan(0)
    for (const subpath of subpaths) {
      expect(existsSync(join(coreDir, subpath, 'package.json')), `@posthog/core/${subpath}`).toBe(true)
    }
  })
})
