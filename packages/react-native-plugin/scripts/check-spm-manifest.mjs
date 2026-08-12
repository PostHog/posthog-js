import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const podspec = readFileSync(path.join(packageRoot, 'posthog-react-native-plugin.podspec'), 'utf8')
const manifest = readFileSync(path.join(packageRoot, 'ios', 'Package.swift'), 'utf8')

const podspecVersion = podspec.match(/posthog_ios_version = '([^']+)'/)?.[1]
const spmVersion = manifest.match(/\.upToNextMinor\(from: "([^"]+)"\)/)?.[1]

assert.ok(podspecVersion, 'Could not find the posthog-ios version in the podspec')
assert.ok(spmVersion, 'Could not find the posthog-ios version in ios/Package.swift')
assert.equal(spmVersion, podspecVersion, 'The CocoaPods and SwiftPM posthog-ios version floors must match')
assert.match(
  manifest,
  /\.library\(\s*name: "ReactNativePlugin"/,
  'The SwiftPM product name must match React Native’s derived name for @posthog/react-native-plugin'
)
assert.match(manifest, /swiftLanguageModes: \[\.v5\]/, 'The Swift package must preserve CocoaPods’ Swift 5 mode')
