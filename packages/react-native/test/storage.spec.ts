import { PostHogRNStorage } from '../src/storage'

jest.mock('expo-file-system')
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}))

// Mock the file system instance with new API
const mockFile = {
  text: jest.fn(),
  write: jest.fn(),
}

const mockedFileSystem = {
  Paths: {
    document: {
      info: jest.fn().mockReturnValue({ uri: '/mock/document/path/' }),
    },
  },
  File: jest.fn().mockImplementation(() => mockFile),
} as any

// Mock the OptionalExpoFileSystemLegacy to be undefined so we use the new API
jest.mock('../src/optional/OptionalExpoFileSystemLegacy', () => ({
  OptionalExpoFileSystemLegacy: undefined,
}))

// Mock the OptionalExpoFileSystem to return our mocked FileSystem
jest.mock('../src/optional/OptionalExpoFileSystem', () => ({
  OptionalExpoFileSystem: mockedFileSystem,
}))

describe('PostHog React Native', () => {
  jest.useRealTimers()

  describe('storage', () => {
    let storage: PostHogRNStorage
    beforeEach(() => {
      // Reset mocks
      jest.clearAllMocks()

      // Import after mocks are set up
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const { buildOptimisiticAsyncStorage } = require('../src/native-deps')

      // Set up the mock file behavior
      mockFile.text.mockResolvedValue(
        JSON.stringify({
          version: 'v1',
          content: {
            foo: 'bar',
          },
        })
      )

      storage = new PostHogRNStorage(buildOptimisiticAsyncStorage())
    })

    it('should load storage from the file system', async () => {
      expect(storage.getItem('foo')).toEqual(undefined)
      await storage.preloadPromise
      expect(mockedFileSystem.File).toHaveBeenCalledWith('/mock/document/path/.posthog-rn.json')
      expect(mockFile.text).toHaveBeenCalledTimes(1)
      expect(storage.getItem('foo')).toEqual('bar')
    })

    it('should save storage to the file system', async () => {
      storage.setItem('foo', 'bar2')
      expect(storage.getItem('foo')).toEqual('bar2')

      expect(mockedFileSystem.File).toHaveBeenCalledWith('/mock/document/path/.posthog-rn.json')
      expect(mockFile.write).toHaveBeenCalledWith(
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
