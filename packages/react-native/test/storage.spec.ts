import * as FileSystem from 'expo-file-system'
import { PostHogRNStorage } from '../src/storage'
import { buildOptimisiticAsyncStorage } from '../src/native-deps'

jest.mock('expo-file-system')
const mockedFileSystem = jest.mocked(FileSystem, true)

describe('PostHog React Native', () => {
  jest.useRealTimers()

  describe('storage', () => {
    let storage: PostHogRNStorage
    beforeEach(() => {
      mockedFileSystem.readAsStringAsync.mockImplementation(() => {
        const res = Promise.resolve(
          JSON.stringify({
            version: 'v1',
            content: {
              foo: 'bar',
            },
          })
        )
        return res
      })

      storage = new PostHogRNStorage(buildOptimisiticAsyncStorage())
    })

    it('should load storage from the file system', async () => {
      expect(storage.getItem('foo')).toEqual(undefined)
      await storage.preloadPromise
      expect(mockedFileSystem.readAsStringAsync).toHaveBeenCalledTimes(1)
      expect(storage.getItem('foo')).toEqual('bar')
    })

    it('should save storage to the file system', async () => {
      storage.setItem('foo', 'bar2')
      expect(storage.getItem('foo')).toEqual('bar2')
      expect(mockedFileSystem.writeAsStringAsync).toHaveBeenCalledWith(
        '.posthog-rn.json',
        JSON.stringify({
          version: 'v1',
          content: {
            foo: 'bar2',
          },
        })
      )
    })
  })
})
