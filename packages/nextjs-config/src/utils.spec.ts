import { isTurbopackEnabled } from './utils'

const nextPackage = vi.hoisted(() => ({ version: '16.3.8' }))
vi.mock('next/package.json', () => ({ default: nextPackage }))

describe('isTurbopackEnabled', () => {
  const originalArgv = process.argv

  beforeEach(() => {
    process.argv = ['node', 'next', 'build']
    vi.stubEnv('TURBOPACK', undefined)
    vi.stubEnv('WEBPACK', undefined)
    vi.stubEnv('NEXT_PRIVATE_WORKER', undefined)
    vi.stubEnv('NEXT_PRIVATE_BUILD_WORKER', undefined)
    nextPackage.version = '16.3.8'
  })

  afterEach(() => {
    process.argv = originalArgv
    vi.unstubAllEnvs()
  })

  it.each(['build', 'dev'])('honors next %s --webpack without a WEBPACK environment variable', (command) => {
    process.argv = ['node', 'next', command, '--webpack']
    expect(isTurbopackEnabled()).toBe(false)
  })

  it.each(['1', 'auto'])('gives --webpack precedence over TURBOPACK=%s', (value) => {
    process.argv.push('--webpack')
    vi.stubEnv('TURBOPACK', value)
    expect(isTurbopackEnabled()).toBe(false)
  })

  it.each(['16.0.0', '16.3.8', '17.0.0'])('retains the Turbopack default on Next %s', (version) => {
    nextPackage.version = version
    expect(isTurbopackEnabled()).toBe(true)
  })

  it.each(['14.2.33', '15.5.22'])('retains the webpack default on Next %s', (version) => {
    nextPackage.version = version
    expect(isTurbopackEnabled()).toBe(false)
  })

  it.each(['--turbo', '--turbopack'])('recognizes the environment set by Next for %s', (flag) => {
    nextPackage.version = '15.5.22'
    process.argv.push(flag)
    vi.stubEnv('TURBOPACK', '1')
    expect(isTurbopackEnabled()).toBe(true)
  })

  it('recognizes the automatic Turbopack environment marker', () => {
    vi.stubEnv('TURBOPACK', 'auto')
    expect(isTurbopackEnabled()).toBe(true)
  })

  describe.each(['NEXT_PRIVATE_WORKER', 'NEXT_PRIVATE_BUILD_WORKER'])('%s', (workerMarker) => {
    beforeEach(() => {
      // Next's child processes do not inherit the parent's --webpack argument.
      process.argv = ['node', 'next-worker.js']
      vi.stubEnv(workerMarker, '1')
    })

    it('uses webpack when the child has no Turbopack marker', () => {
      expect(isTurbopackEnabled()).toBe(false)
    })

    it.each(['1', 'auto'])('preserves TURBOPACK=%s in a child process', (value) => {
      vi.stubEnv('TURBOPACK', value)
      expect(isTurbopackEnabled()).toBe(true)
    })

    it('only recognizes the enabled worker marker', () => {
      vi.stubEnv(workerMarker, '0')
      expect(isTurbopackEnabled()).toBe(true)
    })
  })

  it('preserves the existing WEBPACK=1 override', () => {
    vi.stubEnv('WEBPACK', '1')
    expect(isTurbopackEnabled()).toBe(false)
  })
})
