import { Platform } from 'react-native'
import { getAppProperties } from '../src/native-deps'

vi.mock('../src/optional/OptionalExpoDevice', () => ({ OptionalExpoDevice: undefined }))
vi.mock('../src/optional/OptionalExpoApplication', () => ({ OptionalExpoApplication: undefined }))
vi.mock('../src/optional/OptionalReactNativeDeviceInfo', () => ({ OptionalReactNativeDeviceInfo: undefined }))

const platform = Platform as unknown as { OS: string; Version: string | number; constants?: unknown }

describe('getAppProperties OS fallback without a device-info library', () => {
  const original = { OS: platform.OS, Version: platform.Version }

  afterEach(() => {
    platform.OS = original.OS
    platform.Version = original.Version
    delete platform.constants
  })

  it('reports Android with the release version, not the API level', () => {
    platform.OS = 'android'
    platform.Version = 36
    platform.constants = { Release: '16' }
    expect(getAppProperties()).toMatchObject({ $os_name: 'Android', $os_version: '16' })
  })

  it('reports the iOS system name and version', () => {
    platform.OS = 'ios'
    platform.Version = '18.2'
    platform.constants = { systemName: 'iPadOS' }
    expect(getAppProperties()).toMatchObject({ $os_name: 'iPadOS', $os_version: '18.2' })
  })

  it('defaults the iOS name when the platform constants omit it', () => {
    platform.OS = 'ios'
    platform.Version = '18.2'
    expect(getAppProperties()).toMatchObject({ $os_name: 'iOS', $os_version: '18.2' })
  })

  it('leaves OS properties unset on web', () => {
    platform.OS = 'web'
    const properties = getAppProperties()
    expect(properties).not.toHaveProperty('$os_name')
    expect(properties).not.toHaveProperty('$os_version')
  })
})
