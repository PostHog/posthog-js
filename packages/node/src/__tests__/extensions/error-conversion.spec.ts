import { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import { constants, type ReadStream } from 'node:fs'
import { mkdtemp, open, rename, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
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

  describe('source context file reads', () => {
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

    it('scopes successful and failed source caches to the working directory', async () => {
      const rootA = await makeTemporaryDirectory(tmpdir())
      const rootB = await makeTemporaryDirectory(tmpdir())
      const cachedFilename = 'cached.ts'
      const failedFilename = 'failed.ts'
      await writeFile(join(rootA, cachedFilename), 'root A context\n')
      await writeFile(join(rootB, cachedFilename), 'root B context\n')
      await writeFile(join(rootB, failedFilename), 'root B context\n')

      process.chdir(rootA)
      const rootACachedFrame = makeFrame(cachedFilename)
      const rootAFailedFrame = makeFrame(failedFilename)
      await addSourceContext([rootACachedFrame, rootAFailedFrame])
      expect(rootACachedFrame.context_line).toBe('root A context')
      expect(rootAFailedFrame.context_line).toBeUndefined()

      process.chdir(rootB)
      const rootBCachedFrame = makeFrame(cachedFilename)
      const rootBValidFrame = makeFrame(failedFilename)
      await addSourceContext([rootBCachedFrame, rootBValidFrame])

      expect(rootBCachedFrame.context_line).toBe('root B context')
      expect(rootBValidFrame.context_line).toBe('root B context')
    })

    it('preserves source context for regular files outside the working directory', async () => {
      const directory = await makeTemporaryDirectory(tmpdir())
      const outsideFile = join(directory, 'outside.ts')
      await writeFile(outsideFile, 'outside context\n')
      const frames = [makeFrame(outsideFile), makeFrame(relative(process.cwd(), outsideFile))]

      await addSourceContext(frames)

      expect(frames[0].context_line).toBe('outside context')
      expect(frames[1].context_line).toBe('outside context')
    })

    it('preserves absolute source context when the working directory was removed', async () => {
      const removedDirectory = await makeTemporaryDirectory(tmpdir())
      const sourceDirectory = await makeTemporaryDirectory(tmpdir())
      const sourceFile = join(sourceDirectory, 'source.ts')
      await writeFile(sourceFile, 'absolute context\n')
      process.chdir(removedDirectory)
      await rm(removedDirectory, { recursive: true, force: true })
      const frame = makeFrame(sourceFile)

      await addSourceContext([frame])

      expect(frame.context_line).toBe('absolute context')
    })

    it('preserves source context for symlinked regular files', async () => {
      const sourceDirectory = await makeTemporaryDirectory(tmpdir())
      const sourceFile = join(sourceDirectory, 'source.ts')
      await writeFile(sourceFile, 'linked context\n')
      const linkDirectory = await makeTemporaryDirectory(tmpdir())
      const linkedFile = join(linkDirectory, 'linked.ts')
      await symlink(sourceFile, linkedFile)
      const frame = makeFrame(linkedFile)

      await addSourceContext([frame])

      expect(frame.context_line).toBe('linked context')
    })

    it('preserves filesystem semantics for paths traversing symlink parents', async () => {
      const sourceRoot = await makeTemporaryDirectory(tmpdir())
      const linkedTarget = await makeTemporaryDirectory(sourceRoot)
      await writeFile(join(sourceRoot, 'source.ts'), 'target context\n')
      const linkRoot = await makeTemporaryDirectory(tmpdir())
      await writeFile(join(linkRoot, 'source.ts'), 'lexically normalized context\n')
      const linkedDirectory = join(linkRoot, 'linked-directory')
      await symlink(linkedTarget, linkedDirectory, 'dir')
      const frame = makeFrame(`${linkedDirectory}${sep}..${sep}source.ts`)

      await addSourceContext([frame])

      expect(frame.context_line).toBe('target context')
    })

    it('reads from the validated descriptor when the source path is replaced', async () => {
      const directory = await makeTemporaryDirectory(tmpdir())
      const sourceFile = join(directory, 'application.ts')
      const openedFile = join(directory, 'opened.ts')
      const replacementFile = join(directory, 'replacement.ts')
      await writeFile(sourceFile, 'original context\n')
      await writeFile(replacementFile, 'replacement context\n')
      const openSourceFile = jest.fn(async (path: string, flags: number) => {
        expect(path).toBe(sourceFile)
        expect(flags & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK)
        const fileHandle = await open(path, flags)
        await rename(sourceFile, openedFile)
        await rename(replacementFile, sourceFile)
        return fileHandle
      })
      const frame = makeFrame(sourceFile)

      await addSourceContext([frame], openSourceFile)

      expect(openSourceFile).toHaveBeenCalledTimes(1)
      expect(frame.context_line).toBe('original context')
    })

    it('closes the descriptor when stream initialization fails', async () => {
      const directory = await makeTemporaryDirectory(tmpdir())
      const sourceFile = join(directory, 'source.ts')
      await writeFile(sourceFile, 'source context\n')
      const fileHandle = await open(sourceFile, constants.O_RDONLY)
      const closeSourceFile = jest.spyOn(fileHandle, 'close')
      jest.spyOn(fileHandle, 'createReadStream').mockImplementation(() => {
        throw new Error('stream initialization failed')
      })
      const frame = makeFrame(sourceFile)

      await addSourceContext([frame], async () => fileHandle)

      expect(closeSourceFile).toHaveBeenCalledTimes(1)
      expect(frame.context_line).toBeUndefined()
    })

    it('destroys the stream after collecting an early line range', async () => {
      const directory = await makeTemporaryDirectory(tmpdir())
      const sourceFile = join(directory, 'source.ts')
      await writeFile(sourceFile, 'source context\n'.repeat(100_000))
      const fileHandle = await open(sourceFile, constants.O_RDONLY)
      const createSourceStream = fileHandle.createReadStream.bind(fileHandle)
      let sourceStream: ReadStream | undefined
      jest.spyOn(fileHandle, 'createReadStream').mockImplementation((options) => {
        sourceStream = createSourceStream(options)
        return sourceStream
      })
      const frame = makeFrame(sourceFile)

      await addSourceContext([frame], async () => fileHandle)

      expect(frame.context_line).toBe('source context')
      expect(sourceStream?.destroyed).toBe(true)
    })

    it('does not read oversized regular files', async () => {
      const directory = await makeTemporaryDirectory(tmpdir())
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
