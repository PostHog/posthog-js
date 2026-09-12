import { compileModsAsync, withAppBuildGradle, withProjectBuildGradle } from '@expo/config-plugins'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import * as postHogExpoPluginModule from '../src/tooling/expoconfig'

const postHogExpoPlugin = (postHogExpoPluginModule as any).default

const projectGradle =
  'buildscript {\n    dependencies {\n        classpath("com.android.tools.build:gradle")\n    }\n}\n'
const appGradle = 'apply plugin: "com.android.application"\n\nandroid {\n    namespace "com.example"\n}\n'
const applyLine = 'apply plugin: "com.posthog.android"'
const mainActivityDir = 'android/app/src/main/java/com/example'
const mainActivity = `package com.example

import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun getMainComponentName(): String = "main"
}
`

// Use Expo's real providers/compiler so both mod-kind ordering and persisted files are exercised.
describe.each([false, true])('Android native symbols with earlier app mod: %s', (earlierAppMod) => {
  let projectRoot: string

  beforeEach(() => {
    vi.useRealTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-expo-android-'))
    fs.mkdirSync(path.join(projectRoot, mainActivityDir), { recursive: true })
    fs.writeFileSync(path.join(projectRoot, 'android/build.gradle'), projectGradle)
    fs.writeFileSync(path.join(projectRoot, 'android/app/build.gradle'), appGradle)
    fs.writeFileSync(path.join(projectRoot, 'android/gradle.properties'), '')
    fs.writeFileSync(path.join(projectRoot, mainActivityDir, 'MainActivity.kt'), mainActivity)
  })

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true })
    vi.restoreAllMocks()
    vi.useFakeTimers()
  })

  async function prebuild(uploadNativeSymbols = true, props: Record<string, unknown> = {}) {
    let config: any = { name: 'Test', slug: 'test' }
    const appMod = vi.fn((config) => config)
    const projectMod = vi.fn((config) => config)
    if (earlierAppMod) {
      config = withAppBuildGradle(config, appMod)
    }
    config = postHogExpoPlugin(config, { uploadNativeSymbols, ...props })
    if (!earlierAppMod) {
      config = withAppBuildGradle(config, appMod)
    }
    config = withProjectBuildGradle(config, projectMod)
    await compileModsAsync(config, { projectRoot, platforms: ['android'] })
    expect(appMod).toHaveBeenCalledTimes(1)
    expect(projectMod).toHaveBeenCalledTimes(1)
  }

  function readGradle(file: string) {
    return fs.readFileSync(path.join(projectRoot, 'android', file), 'utf8')
  }

  function readMainActivity() {
    return fs.readFileSync(path.join(projectRoot, mainActivityDir, 'MainActivity.kt'), 'utf8')
  }

  it('writes both native-symbol Gradle edits and remains idempotent on another prebuild', async () => {
    await prebuild()
    const project = readGradle('build.gradle')
    const app = readGradle('app/build.gradle')
    expect(project).toContain('classpath("com.posthog:posthog-android-gradle-plugin:')
    expect(app.split(applyLine)).toHaveLength(2)
    expect(app).toContain('posthog.gradle')
    expect(console.warn).not.toHaveBeenCalled()

    await prebuild()
    expect(readGradle('build.gradle')).toBe(project)
    expect(readGradle('app/build.gradle')).toBe(app)
  })

  it('does not apply the plugin when the project has no buildscript dependencies', async () => {
    fs.writeFileSync(path.join(projectRoot, 'android/build.gradle'), 'buildscript { repositories { google() } }')
    await prebuild()
    expect(readGradle('build.gradle')).not.toContain('posthog-android-gradle-plugin')
    expect(readGradle('app/build.gradle')).not.toContain(applyLine)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not find a buildscript dependencies block')
    )
  })

  it('does not apply the plugin for a Kotlin project Gradle file', async () => {
    fs.renameSync(path.join(projectRoot, 'android/build.gradle'), path.join(projectRoot, 'android/build.gradle.kts'))
    await prebuild()
    expect(readGradle('build.gradle.kts')).toBe(projectGradle)
    expect(readGradle('app/build.gradle')).not.toContain(applyLine)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('project build.gradle is not groovy'))
  })

  it('does not apply the native plugin for a Kotlin app Gradle file', async () => {
    fs.renameSync(
      path.join(projectRoot, 'android/app/build.gradle'),
      path.join(projectRoot, 'android/app/build.gradle.kts')
    )
    await prebuild()
    expect(readGradle('app/build.gradle.kts')).not.toContain(applyLine)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('app build.gradle is not groovy'))
  })

  it('leaves native-symbol setup disabled when not requested', async () => {
    await prebuild(false)
    expect(readGradle('build.gradle')).toBe(projectGradle)
    expect(readGradle('app/build.gradle')).not.toContain(applyLine)
    expect(readGradle('app/build.gradle')).toContain('posthog.gradle')
  })

  it('writes the MainActivity onNewIntent override and remains idempotent on another prebuild', async () => {
    await prebuild()
    const patched = readMainActivity()
    expect(patched).toContain('override fun onNewIntent(intent: android.content.Intent) {')
    expect(patched).toContain('setIntent(intent)')
    expect(console.warn).not.toHaveBeenCalled()

    await prebuild()
    expect(readMainActivity()).toBe(patched)
  })

  it('removes the override again when opted out', async () => {
    await prebuild()
    await prebuild(true, { patchMainActivityNewIntent: false })
    expect(readMainActivity()).toBe(mainActivity)
  })
})
