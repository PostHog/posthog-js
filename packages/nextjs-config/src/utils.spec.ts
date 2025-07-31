import { buildLocalBinaryPaths, callPosthogCli } from './utils'
import { spawn } from 'child_process'
import fs from 'fs'

jest.mock('child_process')
jest.mock('fs')

const mockSpawn = jest.mocked(spawn)
const mockExistsSync = jest.mocked(fs.existsSync)

const originalDirname = global.__dirname

describe('buildLocalBinaryPaths', () => {
  it('generates possible binary locations', () => {
    const cwd = '/home/user'
    const result = buildLocalBinaryPaths(cwd)
    expect(result.includes('/home/user/node_modules/.bin')).toBe(true)
    expect(result.includes('/home/node_modules/.bin')).toBe(true)
    expect(result.includes('/node_modules/.bin')).toBe(true)
  })
})

describe('callPosthogCli', () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(true)
    mockSpawn.mockReturnValue({
      on: jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 0)
        }
      }),
    } as any)
  })

  afterEach(() => {
    global.__dirname = originalDirname
  })

  it('should not throw an error when __dirname is undefined in ESM context', async () => {
    // CJS context
    await expect(callPosthogCli(['--version'], process.env, false)).resolves.toBeUndefined()

    // Simulate ESM context where __dirname is undefined
    global.__dirname = undefined as any
    await expect(callPosthogCli(['--version'], process.env, false)).resolves.toBeUndefined()

    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })
})
