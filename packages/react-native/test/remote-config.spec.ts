import { getRemoteConfigBool } from '../src/utils'

describe('getRemoteConfigBool', () => {
  it('returns default value when field is undefined', () => {
    expect(getRemoteConfigBool(undefined, 'key')).toBe(true)
    expect(getRemoteConfigBool(undefined, 'key', false)).toBe(false)
  })

  it('returns default value when field is null', () => {
    expect(getRemoteConfigBool(null as any, 'key')).toBe(true)
    expect(getRemoteConfigBool(null as any, 'key', false)).toBe(false)
  })

  it('returns the boolean directly when field is boolean true', () => {
    expect(getRemoteConfigBool(true, 'key')).toBe(true)
  })

  it('returns the boolean directly when field is boolean false', () => {
    expect(getRemoteConfigBool(false, 'key')).toBe(false)
    expect(getRemoteConfigBool(false, 'key', true)).toBe(false)
  })

  it('returns the key value when field is an object with the key as boolean true', () => {
    expect(getRemoteConfigBool({ autocaptureExceptions: true }, 'autocaptureExceptions')).toBe(true)
  })

  it('returns the key value when field is an object with the key as boolean false', () => {
    expect(getRemoteConfigBool({ autocaptureExceptions: false }, 'autocaptureExceptions')).toBe(false)
  })

  it('returns default value when field is an object without the key', () => {
    expect(getRemoteConfigBool({ otherKey: 'value' }, 'autocaptureExceptions')).toBe(true)
    expect(getRemoteConfigBool({ otherKey: 'value' }, 'autocaptureExceptions', false)).toBe(false)
  })

  it('returns default value when field is an object with a non-boolean key value', () => {
    expect(getRemoteConfigBool({ autocaptureExceptions: 'yes' }, 'autocaptureExceptions')).toBe(true)
    expect(getRemoteConfigBool({ autocaptureExceptions: 'yes' }, 'autocaptureExceptions', false)).toBe(false)
  })

  it('works with network_timing key', () => {
    expect(getRemoteConfigBool({ network_timing: true, web_vitals: false }, 'network_timing')).toBe(true)
    expect(getRemoteConfigBool({ network_timing: false, web_vitals: true }, 'network_timing')).toBe(false)
  })

  it('works with consoleLogRecordingEnabled key', () => {
    expect(
      getRemoteConfigBool({ endpoint: '/s/', consoleLogRecordingEnabled: true }, 'consoleLogRecordingEnabled')
    ).toBe(true)
    expect(
      getRemoteConfigBool({ endpoint: '/s/', consoleLogRecordingEnabled: false }, 'consoleLogRecordingEnabled')
    ).toBe(false)
  })

  it('returns default true by default', () => {
    expect(getRemoteConfigBool(undefined, 'key')).toBe(true)
  })

  it('returns empty object defaults to true (key missing)', () => {
    expect(getRemoteConfigBool({}, 'key')).toBe(true)
  })
})
