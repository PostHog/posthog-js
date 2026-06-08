import fs from 'node:fs/promises'
import path from 'node:path'

const SOURCE_MAPPING_URL_COMMENT = /^[ \t]*\/\/# sourceMappingURL=([^\r\n]*)[ \t]*$/gm

// Turbopack's `productionBrowserSourceMaps` always appends a `//# sourceMappingURL=`
// comment and has no "hidden" mode like the webpack (`append: false`) and rollup
// (`sourcemap: 'hidden'`) plugins. Once the CLI has uploaded and deleted the browser
// maps, the comment is left pointing at a missing file, so we strip it here.
export async function stripDanglingSourceMapComments(distDir: string): Promise<void> {
  let jsFiles: string[]
  try {
    jsFiles = await listJsFiles(path.join(distDir, 'static'))
  } catch {
    return
  }
  for (const file of jsFiles) {
    try {
      await stripDanglingComment(file)
    } catch {
      // Best-effort: the maps are already uploaded and deleted, so one unreadable
      // chunk must not abort the rest or fail an otherwise successful build.
    }
  }
}

async function listJsFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listJsFiles(fullPath)))
    } else if (entry.isFile() && /\.[mc]?js$/.test(fullPath)) {
      files.push(fullPath)
    }
  }
  return files
}

async function stripDanglingComment(file: string): Promise<void> {
  const content = await fs.readFile(file, 'utf8')
  const match = [...content.matchAll(SOURCE_MAPPING_URL_COMMENT)].pop()
  if (!match) {
    return
  }
  const url = (match[1] ?? '').trim()
  if (url === '' || url.startsWith('data:') || (await exists(path.resolve(path.dirname(file), url)))) {
    return
  }
  let lineEnd = match.index + match[0].length
  if (content[lineEnd] === '\r') {
    lineEnd += 1
  }
  if (content[lineEnd] === '\n') {
    lineEnd += 1
  }
  await fs.writeFile(file, content.slice(0, match.index) + content.slice(lineEnd), 'utf8')
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
