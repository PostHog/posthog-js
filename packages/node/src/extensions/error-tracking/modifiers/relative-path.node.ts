import { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import { relative, isAbsolute, sep } from 'path'

export function createRelativePathModifier(basePath: string = process.cwd()) {
  const normalizedBase = sep === '\\' ? basePath.replace(/\\/g, '/') : basePath

  return async (frames: CoreErrorTracking.StackFrame[]): Promise<CoreErrorTracking.StackFrame[]> => {
    for (const frame of frames) {
      if (!frame.filename || frame.filename.startsWith('node:') || frame.filename.startsWith('data:')) {
        continue
      }
      if (isAbsolute(frame.filename)) {
        const normalizedFilename = sep === '\\' ? frame.filename.replace(/\\/g, '/') : frame.filename
        frame.filename = relative(normalizedBase, normalizedFilename)
        if (sep === '\\') {
          frame.filename = frame.filename.replace(/\\/g, '/')
        }
      }
    }
    return frames
  }
}
