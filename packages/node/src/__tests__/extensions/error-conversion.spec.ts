import { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import { constants } from 'node:fs'
import { mkdtemp, open, realpath, rename, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { createModulerModifier } from '@/extensions/error-tracking/modifiers/module.node'
import { addSourceContext, MAX_CONTEXTLINES_FILE_SIZE } from '@/extensions/error-tracking/modifiers/context-lines.node'
import { createRelativePathModifier } from '@/extensions/error-tracking/modifiers/relative-path.node'

describe('error conversion', () => {
  const errorPropertiesBuilder = new CoreErrorTracking.ErrorPropertiesBuilder(
    [
      new CoreErrorTracking.EventCoercer(),
      new CoreErrorTracking.ErrorCoercer(),
      new CoreErrorTracking.ObjectCoercer(),
      new CoreErrorTracking.StringCoercer(),
      new CoreErrorTracking.PrimitiveCoercer(),
    ],
    CoreErrorTracking.createStackParser('node:javascript', CoreErrorTracking.nodeStackLineParser),
    [createModulerModifier(), addSourceContext, createRelativePathModifier()]
  )

  async function getExceptionList(error: unknown): Promise<CoreErrorTracking.ErrorProperties['$exception_list']> {
    const syntheticException = new Error('PostHog syntheticException')
    const { $exception_list } = errorPropertiesBuilder.buildFromUnknown(error, {
      syntheticException,
    })
    return await errorPropertiesBuilder.modifyFrames($exception_list)
  }

  it('should create an exception list from a string', async () => {
    const exceptionList = await getExceptionList('My string error')
    expect(exceptionList.length).toEqual(1)
    expect(exceptionList[0].value).toEqual('My string error')
  })

  it('should use the error key in object', async () => {
    const errorObject = { error: new Error('My special error') }
    const exceptionList = await getExceptionList(errorObject)
    expect(exceptionList.length).toEqual(1)
    expect(exceptionList[0].value).toEqual('My special error')
  })

  it('should create an exception list from an error cause', async () => {
    const originalError = new Error('original error')
    const error = new Error('test error', { cause: originalError })
    const exceptionList = await getExceptionList(error)
    expect(exceptionList.length).toEqual(2)
    expect(exceptionList[0].value).toEqual('test error')
    expect(exceptionList[1].value).toEqual('original error')
  })

  it('should create an exception list from a non error cause', async () => {
    const originalError = { error_code: 'XASKJASK' }
    const error = new Error('test error', { cause: originalError })
    const exceptionList = await getExceptionList(error)
    expect(exceptionList.length).toEqual(2)
    expect(exceptionList[0].value).toEqual('test error')
    expect(exceptionList[1].value).toEqual('Object captured as exception with keys: error_code')
  })

  describe('source context file safety', () => {
    const originalWorkingDirectory = process.cwd()
    const temporaryPaths: string[] = []

    function makeFrame(filename: string, lineno = 1): CoreErrorTracking.StackFrame {
      return {
        platform: 'node:javascript',
        filename,
        function: 'test',
        lineno,
        colno: 1,
        in_app: true,
      }
    }

    async function makeTemporaryDirectory(parent: string): Promise<string> {
      const path = await mkdtemp(join(parent, 'posthog-context-lines-'))
      temporaryPaths.push(path)
      return path
    }

    afterEach(async () => {
      process.chdir(originalWorkingDirectory)
      await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
    })

    it('preserves source context for regular application files', async () => {
      const directory = await makeTemporaryDirectory(process.cwd())
      const sourceFile = join(directory, 'application.ts')
      await writeFile(sourceFile, 'first\nsecond\nthrow new Error("test")\nfourth\n')
      const frame = makeFrame(sourceFile, 3)

      await addSourceContext([frame])

      expect(frame.pre_context).toEqual(['first', 'second'])
      expect(frame.context_line).toBe('throw new Error("test")')
      expect(frame.post_context).toEqual(['fourth'])
    })

    it('scopes successful and failed source caches to the canonical project root', async () => {
      const rootA = await makeTemporaryDirectory(tmpdir())
      const rootB = await makeTemporaryDirectory(tmpdir())
      const cachedFilename = 'cached.ts'
      const failedFilename = 'failed.ts'
      const rootASourceFile = join(rootA, cachedFilename)
      await writeFile(rootASourceFile, 'root A context\n')

      process.chdir(rootA)
      const rootACachedFrame = makeFrame(cachedFilename)
      const rootAFailedFrame = makeFrame(failedFilename)
      await addSourceContext([rootACachedFrame, rootAFailedFrame])
      expect(rootACachedFrame.context_line).toBe('root A context')
      expect(rootAFailedFrame.context_line).toBeUndefined()

      await symlink(rootASourceFile, join(rootB, cachedFilename))
      await writeFile(join(rootB, failedFilename), 'root B context\n')
      process.chdir(rootB)
      const rootBOutsideFrame = makeFrame(cachedFilename)
      const rootBValidFrame = makeFrame(failedFilename)

      await addSourceContext([rootBOutsideFrame, rootBValidFrame])

      expect(rootBOutsideFrame.context_line).toBeUndefined()
      expect(rootBValidFrame.context_line).toBe('root B context')
    })

    it('does not read regular files outside the project root', async () => {
      const directory = await makeTemporaryDirectory(tmpdir())
      const outsideFile = join(directory, 'outside.ts')
      await writeFile(outsideFile, 'outside secret\n')
      const frames = [makeFrame(outsideFile), makeFrame(relative(process.cwd(), outsideFile))]

      await addSourceContext(frames)

      expect(frames[0].context_line).toBeUndefined()
      expect(frames[1].context_line).toBeUndefined()
    })

    it('does not follow project symlinks to files outside the project root', async () => {
      const outsideDirectory = await makeTemporaryDirectory(tmpdir())
      const outsideFile = join(outsideDirectory, 'outside.ts')
      await writeFile(outsideFile, 'outside secret\n')
      const projectDirectory = await makeTemporaryDirectory(process.cwd())
      const linkedFile = join(projectDirectory, 'linked.ts')
      await symlink(await realpath(outsideFile), linkedFile)
      const frame = makeFrame(linkedFile)

      await addSourceContext([frame])

      expect(frame.context_line).toBeUndefined()
    })

    it('rejects a source path replaced after its descriptor is opened', async () => {
      const directory = await makeTemporaryDirectory(process.cwd())
      const sourceFile = join(directory, 'application.ts')
      const openedFile = join(directory, 'opened.ts')
      const replacementFile = join(directory, 'replacement.ts')
      await writeFile(sourceFile, 'original context\n')
      await writeFile(replacementFile, 'replacement context\n')
      const openSourceFile = jest.fn(async () => {
        const fileHandle = await open(sourceFile, constants.O_RDONLY | constants.O_NOFOLLOW)
        await rename(sourceFile, openedFile)
        await rename(replacementFile, sourceFile)
        return fileHandle
      })
      const frame = makeFrame(sourceFile)

      await addSourceContext([frame], openSourceFile)

      expect(openSourceFile).toHaveBeenCalledTimes(1)
      expect(frame.context_line).toBeUndefined()
    })

    it('does not read oversized regular files', async () => {
      const directory = await makeTemporaryDirectory(process.cwd())
      const sourceFile = join(directory, 'oversized.ts')
      await writeFile(sourceFile, '')
      await truncate(sourceFile, MAX_CONTEXTLINES_FILE_SIZE + 1)
      const frame = makeFrame(sourceFile)

      await addSourceContext([frame])

      expect(frame.context_line).toBeUndefined()
    })

    if (process.platform !== 'win32') {
      it.each(['/dev/null', '/dev/zero'])('does not read special file %s', async (specialFile) => {
        const frame = makeFrame(specialFile)

        await addSourceContext([frame])

        expect(frame.context_line).toBeUndefined()
      })
    }
  })
})
