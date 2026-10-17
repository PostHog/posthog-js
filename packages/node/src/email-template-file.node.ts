import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TemplateFiles } from './emails'

export const nodeTemplateFiles: TemplateFiles = {
  locate(file: URL | string): string {
    const path = file instanceof URL ? pathOfFileUrl(file) : file
    if (!isAbsolute(path) || !/\.html$/i.test(path)) {
      throw new TypeError('A template file must be a file: URL or an absolute path to an .html file')
    }
    return path
  },

  read(path: string): Promise<string> {
    return readFile(path, 'utf8')
  },

  sourcePath(path: string): string {
    const fromWorkingDirectory = relative(process.cwd(), path)
    const insideWorkingDirectory = fromWorkingDirectory !== '' && !fromWorkingDirectory.startsWith('..')
    return insideWorkingDirectory && !isAbsolute(fromWorkingDirectory)
      ? fromWorkingDirectory.split(sep).join('/')
      : path
  },
}

function pathOfFileUrl(file: URL): string {
  if (file.protocol !== 'file:') {
    throw new TypeError('A template file must be a file: URL or an absolute path to an .html file')
  }
  return fileURLToPath(file)
}
