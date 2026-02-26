// Test for Expo SDK 54 stable where legacy methods exist but throw deprecation errors
// and the new File/Paths API should be used instead.
// See https://github.com/PostHog/posthog-js/issues/3151

const mockFileWrite = jest.fn()
const mockFileText = jest.fn().mockResolvedValue('stored-value')
const mockDocument = { uri: 'file:///mock-doc-dir/' }

// Mock expo-file-system as it appears in SDK 54 stable:
// - Legacy methods exist but throw deprecation errors
// - New File/Paths API is available
jest.mock('../src/optional/OptionalExpoFileSystem', () => ({
  OptionalExpoFileSystem: {
    // Legacy methods that throw deprecation errors (SDK 54 stable behavior)
    readAsStringAsync: () => {
      throw new Error('Method readAsStringAsync imported from "expo-file-system" is deprecated')
    },
    writeAsStringAsync: () => {
      throw new Error('Method writeAsStringAsync imported from "expo-file-system" is deprecated')
    },
    documentDirectory: '/mock-doc-dir/',
    // New API (SDK 54+)
    Paths: {
      document: mockDocument,
    },
    // File constructor accepts (Directory, ...strings) and joins them
    File: jest.fn().mockImplementation((_dir: any, _key: string) => ({
      text: mockFileText,
      write: mockFileWrite,
    })),
  },
}))

jest.mock('../src/optional/OptionalExpoFileSystemLegacy', () => ({
  OptionalExpoFileSystemLegacy: undefined,
}))

jest.mock('../src/optional/OptionalAsyncStorage', () => ({
  OptionalAsyncStorage: undefined,
}))

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}))

import { buildOptimisticAsyncStorage } from '../src/native-deps'
import { OptionalExpoFileSystem } from '../src/optional/OptionalExpoFileSystem'

describe('Expo SDK 54 stable - new File API detection', () => {
  jest.useRealTimers()

  beforeEach(() => {
    jest.clearAllMocks()
    mockFileText.mockResolvedValue('stored-value')
  })

  it('should use new File/Paths API when both new and deprecated legacy APIs are present', () => {
    const storage = buildOptimisticAsyncStorage()
    expect(storage).toBeDefined()
  })

  it('should pass Paths.document directory and key to File constructor', async () => {
    const storage = buildOptimisticAsyncStorage()!

    const result = await storage.getItem('test-key')
    expect(result).toBe('stored-value')
    // File should be constructed with (Paths.document, key) per expo docs
    expect((OptionalExpoFileSystem as any).File).toHaveBeenCalledWith(mockDocument, 'test-key')
  })

  it('should use File.write for setItem', () => {
    const storage = buildOptimisticAsyncStorage()!

    storage.setItem('test-key', 'test-value')
    expect((OptionalExpoFileSystem as any).File).toHaveBeenCalledWith(mockDocument, 'test-key')
    expect(mockFileWrite).toHaveBeenCalledWith('test-value')
  })

  it('should return null when getItem fails', async () => {
    mockFileText.mockRejectedValue(new Error('File not found'))

    const storage = buildOptimisticAsyncStorage()!
    const result = await storage.getItem('nonexistent-key')
    expect(result).toBeNull()
  })
})
