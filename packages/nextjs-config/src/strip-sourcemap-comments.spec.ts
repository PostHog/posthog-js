import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { stripDanglingSourceMapComments } from './strip-sourcemap-comments'

describe('stripDanglingSourceMapComments', () => {
  let distDir: string

  beforeEach(async () => {
    distDir = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-nextjs-config-'))
  })

  afterEach(async () => {
    await fs.rm(distDir, { recursive: true, force: true })
  })

  async function writeFile(relativePath: string, content: string): Promise<string> {
    const fullPath = path.join(distDir, relativePath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content)
    return fullPath
  }

  it('removes the comment when the referenced map has been deleted', async () => {
    const chunk = await writeFile('static/chunks/page.js', 'console.log(1)\n//# sourceMappingURL=page.js.map\n')

    await stripDanglingSourceMapComments(distDir)

    expect(await fs.readFile(chunk, 'utf8')).toBe('console.log(1)\n')
  })

  it('keeps the comment when the referenced map still exists', async () => {
    const original = 'console.log(2)\n//# sourceMappingURL=page.js.map\n'
    const chunk = await writeFile('static/chunks/page.js', original)
    await writeFile('static/chunks/page.js.map', '{"version":3}')

    await stripDanglingSourceMapComments(distDir)

    expect(await fs.readFile(chunk, 'utf8')).toBe(original)
  })

  it('leaves inline data: source maps untouched', async () => {
    const original = 'console.log(3)\n//# sourceMappingURL=data:application/json;base64,e30=\n'
    const chunk = await writeFile('static/chunks/inline.js', original)

    await stripDanglingSourceMapComments(distDir)

    expect(await fs.readFile(chunk, 'utf8')).toBe(original)
  })

  it('does not touch chunks outside the static directory (e.g. server chunks)', async () => {
    const original = 'console.log(4)\n//# sourceMappingURL=server.js.map\n'
    const chunk = await writeFile('server/chunks/server.js', original)

    await stripDanglingSourceMapComments(distDir)

    expect(await fs.readFile(chunk, 'utf8')).toBe(original)
  })

  it('strips only the dangling reference when several chunks are present', async () => {
    const dangling = await writeFile('static/chunks/a.js', 'a()\n//# sourceMappingURL=a.js.map\n')
    const kept = await writeFile('static/chunks/b.js', 'b()\n//# sourceMappingURL=b.js.map\n')
    await writeFile('static/chunks/b.js.map', '{"version":3}')

    await stripDanglingSourceMapComments(distDir)

    expect(await fs.readFile(dangling, 'utf8')).toBe('a()\n')
    expect(await fs.readFile(kept, 'utf8')).toBe('b()\n//# sourceMappingURL=b.js.map\n')
  })

  it('handles CRLF line endings', async () => {
    const chunk = await writeFile('static/chunks/crlf.js', 'console.log(5)\r\n//# sourceMappingURL=crlf.js.map\r\n')

    await stripDanglingSourceMapComments(distDir)

    expect(await fs.readFile(chunk, 'utf8')).toBe('console.log(5)\r\n')
  })

  it.each(['mjs', 'cjs'])('strips dangling comments from .%s chunks', async (ext) => {
    const chunk = await writeFile(`static/chunks/page.${ext}`, `const x = 1\n//# sourceMappingURL=page.${ext}.map\n`)

    await stripDanglingSourceMapComments(distDir)

    expect(await fs.readFile(chunk, 'utf8')).toBe('const x = 1\n')
  })

  it('leaves remote (http/https) sourceMappingURL comments untouched', async () => {
    const original = 'console.log(7)\n//# sourceMappingURL=https://cdn.example.com/page.js.map\n'
    const chunk = await writeFile('static/chunks/remote.js', original)

    await stripDanglingSourceMapComments(distDir)

    expect(await fs.readFile(chunk, 'utf8')).toBe(original)
  })

  it('is a no-op when there is no static directory', async () => {
    await expect(stripDanglingSourceMapComments(path.join(distDir, 'missing'))).resolves.toBeUndefined()
  })
})
