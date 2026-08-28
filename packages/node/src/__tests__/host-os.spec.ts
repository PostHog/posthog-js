import { platform, release } from 'node:os'
import { hostOsResourceAttributes } from '../host-os.node'

jest.mock('node:os', () => ({ platform: jest.fn(), release: jest.fn() }))

const mockPlatform = platform as jest.Mock
const mockRelease = release as jest.Mock

describe('hostOsResourceAttributes', () => {
  it('reports the host OS', () => {
    mockPlatform.mockReturnValue('linux')
    mockRelease.mockReturnValue('6.1.0-27-amd64')

    expect(hostOsResourceAttributes()).toEqual({ 'os.name': 'linux', 'os.version': '6.1.0-27-amd64' })
  })

  it('omits a key node:os cannot supply rather than emitting it empty', () => {
    mockPlatform.mockReturnValue('linux')
    mockRelease.mockReturnValue('')

    expect(hostOsResourceAttributes()).toEqual({ 'os.name': 'linux' })
  })

  it('returns no attributes when node:os throws', () => {
    mockPlatform.mockImplementation(() => {
      throw new Error('unsupported')
    })
    mockRelease.mockImplementation(() => {
      throw new Error('unsupported')
    })

    expect(hostOsResourceAttributes()).toEqual({})
  })
})
