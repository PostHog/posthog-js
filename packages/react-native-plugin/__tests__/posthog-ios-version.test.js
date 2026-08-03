/* eslint-env node */

import { readFileSync } from 'fs'
import { join } from 'path'

const podspec = readFileSync(join(__dirname, '..', 'posthog-react-native-plugin.podspec'), 'utf8')

describe('posthog-ios dependency', () => {
  it('uses the post-rage-click-fix baseline for CocoaPods and SPM', () => {
    expect(podspec).toContain("posthog_ios_version = '3.69.0'")
    expect(podspec).toContain("s.dependency 'PostHog', \"~> #{posthog_ios_version}\"")
    expect(podspec).toContain("requirement: { kind: 'upToNextMinorVersion', minimumVersion: posthog_ios_version }")
  })
})
