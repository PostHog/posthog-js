// Test for Expo SDK 55 where both the new File/Paths API and a working legacy subpath exist.
// The new API should always be preferred over the legacy subpath.

const mockFileWrite = jest.fn()
const mockFileText = jest.fn().mockResolvedValue('stored-value')
const mockDocument = { uri: 'file:///mock-doc-dir/' }

const mockLegacyReadAsStringAsync = jest.fn()
const mockLegacyWriteAsStringAsync = jest.fn()

// Mock expo-file-system main module (SDK 55): has new File/Paths API + deprecated legacy stubs
jest.mock('../src/optional/OptionalExpoFileSystem', () => ({
  OptionalExpoFileSystem: {
    // Deprecated legacy methods that throw at runtime
    readAsStringAsync: () => {
      throw new Error('Method readAsStringAsync imported from "expo-file-system" is deprecated')
    },
    writeAsStringAsync: () => {
      throw new Error('Method writeAsStringAsync imported from "expo-file-system" is deprecated')
    },
    documentDirectory: '/mock-doc-dir/',
    // New API
    Paths: {
      document: mockDocument,
    },
    File: jest.fn().mockImplementation((_dir: any, _key: string) => ({
      text: mockFileText,
      write: mockFileWrite,
    })),
  },
}))

// Mock expo-file-system/legacy subpath (SDK 55): has working legacy methods
jest.mock('../src/optional/OptionalExpoFileSystemLegacy', () => ({
  OptionalExpoFileSystemLegacy: {
    readAsStringAsync: mockLegacyReadAsStringAsync,
    writeAsStringAsync: mockLegacyWriteAsStringAsync,
    documentDirectory: '/mock-legacy-doc-dir/',
  },
}))

jest.mock('../src/optional/OptionalAsyncStorage', () => ({
  OptionalAsyncStorage: undefined,
}))

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}))

import { buildOptimisticAsyncStorage } from '../src/native-deps'
import { OptionalExpoFileSystem } from '../src/optional/OptionalExpoFileSystem'

describe('Expo SDK 55 - prefers new File API over working legacy subpath', () => {
  jest.useRealTimers()

  beforeEach(() => {
    jest.clearAllMocks()
    mockFileText.mockResolvedValue('stored-value')
  })

  it('should use new File/Paths API even when legacy subpath is available', () => {
    const storage = buildOptimisticAsyncStorage()
    expect(storage).toBeDefined()

    // Verify it uses new API
    storage!.setItem('test-key', 'test-value')
    expect((OptionalExpoFileSystem as any).File).toHaveBeenCalledWith(mockDocument, 'test-key')
    expect(mockFileWrite).toHaveBeenCalledWith('test-value')

    // Legacy methods should NOT be called
    expect(mockLegacyReadAsStringAsync).not.toHaveBeenCalled()
    expect(mockLegacyWriteAsStringAsync).not.toHaveBeenCalled()
  })

  it('should read using new File API, not legacy', async () => {
    const storage = buildOptimisticAsyncStorage()!

    const result = await storage.getItem('test-key')
    expect(result).toBe('stored-value')
    expect((OptionalExpoFileSystem as any).File).toHaveBeenCalledWith(mockDocument, 'test-key')
    expect(mockLegacyReadAsStringAsync).not.toHaveBeenCalled()
  })
})
