import { execFileSync, execSync, spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { POSTHOG_RELEASE_MODES, buildDsymUploadShellScript } from '../src/tooling/expoconfig'

/**
 * These tests validate the sed expressions used in tooling/posthog-xcode.sh
 * to parse a git remote URL into {host, owner/repo}. Rather than re-declare
 * the regexes here (and risk drift), we extract them at test runtime from the
 * shell script itself — so the tests cannot diverge from the source.
 *
 * Also contains regression tests for issue #3682: posthog-xcode.sh was
 * resolving REACT_NATIVE_XCODE to /bin/sh when invoked by the Expo plugin.
 */

const SCRIPT_PATH = path.resolve(__dirname, '..', 'tooling', 'posthog-xcode.sh')

const extractSed = (label: 'GIT_HOST' | 'GIT_REPO_PATH'): string => {
  const contents = fs.readFileSync(SCRIPT_PATH, 'utf8')
  // Match lines like:   GIT_HOST=$(echo "$GIT_REMOTE_URL" | sed -E '<expr>')
  const re = new RegExp(`${label}=\\$\\(echo "\\$GIT_REMOTE_URL" \\| sed -E '([^']+)'\\)`)
  const match = contents.match(re)
  if (!match) {
    throw new Error(`Could not find ${label} sed expression in ${SCRIPT_PATH}`)
  }
  return match[1]
}

const runSed = (sedExpr: string, input: string): string => {
  // Shell-escape the sed expression to pass it through execSync safely.
  const escaped = sedExpr.replace(/'/g, `'\\''`)
  return execSync(`printf %s '${input}' | sed -E '${escaped}'`).toString().trim()
}

const extractCommandErrorBlock = (): string => {
  const contents = fs.readFileSync(SCRIPT_PATH, 'utf8')
  const match = contents.match(/print_prefixed_output\(\) \{[\s\S]+?\n\}\n\nprint_command_error\(\) \{[\s\S]+?\n\}/)
  if (!match) {
    throw new Error(`Could not find posthog-cli error formatting helpers in ${SCRIPT_PATH}`)
  }
  return match[0]
}

describe('posthog-xcode.sh remote URL parsing', () => {
  const HOST_SED = extractSed('GIT_HOST')
  const REPO_SED = extractSed('GIT_REPO_PATH')

  const parse = (url: string): { host: string; repo: string } => ({
    host: runSed(HOST_SED, url),
    repo: runSed(REPO_SED, url),
  })

  const cases: Array<[string, string, string]> = [
    ['git@github.com:PostHog/posthog-js.git', 'github.com', 'PostHog/posthog-js'],
    ['https://github.com/PostHog/posthog-js.git', 'github.com', 'PostHog/posthog-js'],
    ['git@gitlab.com:foo/bar.git', 'gitlab.com', 'foo/bar'],
    ['https://gitlab.com/foo/bar.git', 'gitlab.com', 'foo/bar'],
    ['git@bitbucket.org:foo/bar.git', 'bitbucket.org', 'foo/bar'],
    ['git@git.mycompany.internal:team/repo.git', 'git.mycompany.internal', 'team/repo'],
    ['ssh://git@github.com:22/foo/bar.git', 'github.com', 'foo/bar'],
    ['https://gitlab.com/org/subgroup/repo.git', 'gitlab.com', 'org/subgroup/repo'],
    ['git@gitlab.com:org/subgroup/repo.git', 'gitlab.com', 'org/subgroup/repo'],
    ['https://gitlab.com/org/deep/nested/subgroup/repo.git', 'gitlab.com', 'org/deep/nested/subgroup/repo'],
  ]

  it.each(cases)('parses %s → host=%s repo=%s', (url, expectedHost, expectedRepo) => {
    const { host, repo } = parse(url)
    expect(host).toBe(expectedHost)
    expect(repo).toBe(expectedRepo)
  })

  it('constructs the expected remote_url for github', () => {
    const { host, repo } = parse('git@github.com:PostHog/posthog-js.git')
    expect(`https://${host}/${repo}.git`).toBe('https://github.com/PostHog/posthog-js.git')
  })

  it('constructs the expected remote_url for self-hosted', () => {
    const { host, repo } = parse('git@git.corp.internal:team/repo.git')
    expect(`https://${host}/${repo}.git`).toBe('https://git.corp.internal/team/repo.git')
  })
})

describe('posthog-xcode.sh bundle command composition', () => {
  const scriptContents = fs.readFileSync(SCRIPT_PATH, 'utf8')

  const extractReactNativeXcodeResolutionBlock = (): string => {
    const match = scriptContents.match(/REACT_NATIVE_XCODE_DEFAULT="[^"]+"[\s\S]+?\n\s*done/)
    if (!match) throw new Error('Could not locate REACT_NATIVE_XCODE resolution in posthog-xcode.sh')
    return match[0]
  }

  const resolveReactNativeXcode = (args: string[]): string => {
    const script = `${extractReactNativeXcodeResolutionBlock()}\nprintf '%s' "$REACT_NATIVE_XCODE"`
    return execFileSync('/bin/bash', ['-c', script, 'posthog-xcode-test', ...args]).toString()
  }

  it.each([
    ['direct RN script', ['../node_modules/react-native/scripts/react-native-xcode.sh']],
    ['shell-prefixed RN script', ['/bin/sh', '../node_modules/react-native/scripts/react-native-xcode.sh']],
    [
      'nested source-map wrapper',
      [
        '/bin/sh',
        '../node_modules/@sentry/react-native/scripts/sentry-xcode.sh',
        '../node_modules/react-native/scripts/react-native-xcode.sh',
      ],
    ],
  ])('locates react-native-xcode.sh in a %s command', (_desc, args) => {
    expect(resolveReactNativeXcode(args)).toBe('../node_modules/react-native/scripts/react-native-xcode.sh')
  })

  it('falls back to the standard RN script when an outer wrapper does not forward arguments', () => {
    expect(resolveReactNativeXcode([])).toBe('../node_modules/react-native/scripts/react-native-xcode.sh')
  })

  it('forwards nested commands, preserves the Hermes map, and resolves a hoisted fallback', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-xcode-composition-'))
    const derivedDir = path.join(tempDir, 'derived')
    const configurationDir = path.join(tempDir, 'configuration')
    const homeDir = path.join(tempDir, 'home')
    const iosDir = path.join(tempDir, 'packages', 'example', 'ios')
    const tracePath = path.join(tempDir, 'trace.log')
    const wrapperPath = path.join(tempDir, 'sentry-xcode.sh')
    const reactNativeRoot = path.join(tempDir, 'node_modules', 'react-native')
    const reactNativePath = path.join(reactNativeRoot, 'scripts', 'react-native-xcode.sh')
    const cliPath = path.join(homeDir, '.posthog', 'posthog-cli')

    try {
      for (const directory of [
        derivedDir,
        configurationDir,
        iosDir,
        path.dirname(reactNativePath),
        path.dirname(cliPath),
      ]) {
        fs.mkdirSync(directory, { recursive: true })
      }
      fs.writeFileSync(wrapperPath, '#!/bin/sh\necho wrapper >> "$TRACE_PATH"\n"$@"\n', { mode: 0o755 })
      fs.writeFileSync(path.join(reactNativeRoot, 'package.json'), '{}')
      fs.writeFileSync(
        reactNativePath,
        '#!/bin/sh\necho react-native >> "$TRACE_PATH"\nrm "$PACKAGER_SOURCEMAP_FILE"\n',
        { mode: 0o755 }
      )
      fs.writeFileSync(cliPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 })

      const env = {
        ...process.env,
        CONFIGURATION_BUILD_DIR: configurationDir,
        DERIVED_FILE_DIR: derivedDir,
        HOME: homeDir,
        NODE_BINARY: process.execPath,
        SKIP_BUNDLING: '1',
        TRACE_PATH: tracePath,
      }

      execFileSync(SCRIPT_PATH, ['/bin/sh', wrapperPath, reactNativePath], {
        cwd: iosDir,
        env,
        stdio: 'pipe',
      })

      expect(fs.readFileSync(tracePath, 'utf8').trim().split('\n')).toEqual(['wrapper', 'react-native'])
      expect(fs.readFileSync(reactNativePath, 'utf8')).toContain('#rm "$PACKAGER_SOURCEMAP_FILE"')

      // Sentry only passes its $1 script path to sentry-cli. When Sentry wraps
      // PostHog, posthog-xcode.sh is therefore invoked without the original RN
      // argument and must execute the standard script itself.
      fs.writeFileSync(tracePath, '')
      execFileSync(SCRIPT_PATH, [], { cwd: iosDir, env, stdio: 'pipe' })
      expect(fs.readFileSync(tracePath, 'utf8').trim()).toBe('react-native')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe('posthog-xcode.sh release version resolution', () => {
  const scriptContents = fs.readFileSync(SCRIPT_PATH, 'utf8')

  const extractReleaseInfoBlock = (): string => {
    const match = scriptContents.match(
      /resolve_posthog_ios_release_info\(\) \{[\s\S]+?\n\}\n\nresolve_posthog_ios_release_info/
    )
    if (!match) throw new Error('Could not locate iOS release info resolution in posthog-xcode.sh')
    return match[0]
  }

  const resolveReleaseInfo = (
    tempDir: string,
    plistVersion: string,
    plistBuild: string,
    marketingVersion = '1.0',
    projectVersion = '1',
    buildSettings: Record<string, string> = {}
  ): string => {
    const plistBuddy = path.join(tempDir, 'plist-buddy')
    const infoPlist = path.join(tempDir, 'ExampleApp', 'Info.plist')
    fs.mkdirSync(path.dirname(infoPlist), { recursive: true })
    fs.writeFileSync(infoPlist, '')
    fs.writeFileSync(
      plistBuddy,
      '#!/bin/sh\ncase "$2" in\n  *CFBundleShortVersionString*) printf %s "$TEST_PLIST_VERSION" ;;\n  *CFBundleVersion*) printf %s "$TEST_PLIST_BUILD" ;;\nesac\n',
      { mode: 0o755 }
    )

    const script = `${extractReleaseInfoBlock()}\nprintf '%s|%s' "$POSTHOG_RELEASE_VERSION" "$POSTHOG_BUILD_VERSION"`
    return execFileSync('/bin/bash', ['-c', script], {
      env: {
        ...process.env,
        SRCROOT: tempDir,
        INFOPLIST_FILE: 'ExampleApp/Info.plist',
        POSTHOG_PLIST_BUDDY: plistBuddy,
        MARKETING_VERSION: marketingVersion,
        CURRENT_PROJECT_VERSION: projectVersion,
        TEST_PLIST_VERSION: plistVersion,
        TEST_PLIST_BUILD: plistBuild,
        ...buildSettings,
      },
    }).toString()
  }

  it('prefers Expo source Info.plist versions over generated Xcode defaults', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-xcode-version-'))
    try {
      expect(resolveReleaseInfo(tempDir, '2.10.0', '154')).toBe('2.10.0|154')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('resolves custom Xcode build settings referenced by the source Info.plist', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-xcode-version-'))
    try {
      expect(
        resolveReleaseInfo(tempDir, '$(APP_VERSION)', '${BUILD_NUMBER}', '1.0', '1', {
          APP_VERSION: '9.9.9',
          BUILD_NUMBER: '321',
        })
      ).toBe('9.9.9|321')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('resolves compound Xcode build settings referenced by the source Info.plist', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-xcode-version-'))
    try {
      expect(
        resolveReleaseInfo(tempDir, '$(VERSION_MAJOR).$(VERSION_MINOR)', '$(BUILD_PREFIX)$(BUILD_NUMBER)', '1.0', '1', {
          VERSION_MAJOR: '2',
          VERSION_MINOR: '10.0',
          BUILD_PREFIX: '1',
          BUILD_NUMBER: '54',
        })
      ).toBe('2.10.0|154')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('keeps Xcode versions when Info.plist preprocessing is enabled', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-xcode-version-'))
    try {
      expect(
        resolveReleaseInfo(tempDir, 'APP_VERSION', 'APP_BUILD', '1.0', '1', {
          INFOPLIST_PREPROCESS: 'YES',
        })
      ).toBe('1.0|1')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('keeps Xcode versions when source Info.plist values are unresolved', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-xcode-version-'))
    try {
      expect(resolveReleaseInfo(tempDir, '$(MISSING_VERSION)', '$(A)-$(B)')).toBe('1.0|1')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  const captureReleaseArgs = (cliVersion: string): { commands: string[]; infoPlist: string } => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-xcode-release-args-'))
    const derivedDir = path.join(tempDir, 'derived')
    const configurationDir = path.join(tempDir, 'configuration')
    const homeDir = path.join(tempDir, 'home')
    const sourceRoot = path.join(tempDir, 'source')
    const iosDir = path.join(sourceRoot, 'ios')
    const infoPlist = path.join(sourceRoot, 'ExampleApp', 'Info.plist')
    const reactNativePath = path.join(tempDir, 'react-native-xcode.sh')
    const plistBuddyPath = path.join(tempDir, 'plist-buddy')
    const cliPath = path.join(homeDir, '.posthog', 'posthog-cli')
    const cliTracePath = path.join(tempDir, 'cli-trace.log')

    try {
      for (const directory of [derivedDir, configurationDir, iosDir, path.dirname(infoPlist), path.dirname(cliPath)]) {
        fs.mkdirSync(directory, { recursive: true })
      }
      fs.writeFileSync(infoPlist, '')
      fs.writeFileSync(reactNativePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      fs.writeFileSync(
        plistBuddyPath,
        '#!/bin/sh\ncase "$2" in\n  *CFBundleShortVersionString*) printf %s 2.10.0 ;;\n  *CFBundleVersion*) printf %s 154 ;;\nesac\n',
        { mode: 0o755 }
      )
      fs.writeFileSync(
        cliPath,
        '#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo "posthog-cli $TEST_CLI_VERSION"\n  exit 0\nfi\nprintf "%s\\n" "$*" >> "$TEST_CLI_TRACE"\n',
        { mode: 0o755 }
      )

      execFileSync(SCRIPT_PATH, [reactNativePath], {
        cwd: iosDir,
        env: {
          ...process.env,
          CONFIGURATION_BUILD_DIR: configurationDir,
          CURRENT_PROJECT_VERSION: '1',
          DERIVED_FILE_DIR: derivedDir,
          GITHUB_SHA: 'test-sha',
          HOME: homeDir,
          INFOPLIST_FILE: 'ExampleApp/Info.plist',
          MARKETING_VERSION: '1.0',
          POSTHOG_PLIST_BUDDY: plistBuddyPath,
          PRODUCT_BUNDLE_IDENTIFIER: 'com.example.app',
          SRCROOT: sourceRoot,
          TEST_CLI_TRACE: cliTracePath,
          TEST_CLI_VERSION: cliVersion,
        },
        stdio: 'pipe',
      })

      return {
        commands: fs.readFileSync(cliTracePath, 'utf8').trim().split('\n'),
        infoPlist,
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }

  it.each([
    ['0.15.0', false],
    ['0.15.1', true],
    ['0.16.0', true],
  ])('uses Info.plist arguments with posthog-cli %s: %s', (cliVersion, usesInfoPlist) => {
    const { commands, infoPlist } = captureReleaseArgs(cliVersion)

    expect(commands).toHaveLength(2)
    for (const command of commands) {
      if (usesInfoPlist) {
        expect(command).toContain(`--info-plist ${infoPlist}`)
        expect(command).not.toContain('--release-name')
        expect(command).not.toContain('--release-version')
        expect(command).not.toContain('--build')
      } else {
        expect(command).not.toContain('--info-plist')
        expect(command).toContain('--release-name com.example.app')
        expect(command).toContain('--release-version 2.10.0')
        expect(command).toContain('--build 154')
      }
    }
  })
})

describe('posthog-xcode.sh skipOnConflict upload flag', () => {
  it('passes --skip-on-conflict only to hermes upload', () => {
    const contents = fs.readFileSync(SCRIPT_PATH, 'utf8')

    expect(contents).toContain('POSTHOG_UPLOAD_ARGS+=(--skip-on-conflict)')
    expect(contents).toContain(
      'CLI_UPLOAD_OUTPUT=$("$PH_CLI_PATH" hermes upload --directory "$DERIVED_FILE_DIR" "${CLI_RELEASE_ARGS[@]}" "${POSTHOG_UPLOAD_ARGS[@]}" "${POSTHOG_RELEASE_MODE_ARGS[@]}" 2>&1)'
    )
    expect(contents).not.toContain('hermes clone --skip-on-conflict')
  })
})

describe('posthog-xcode.sh posthog-cli error formatting', () => {
  it('uses multiline Xcode error formatting for clone and upload failures', () => {
    const contents = fs.readFileSync(SCRIPT_PATH, 'utf8')

    expect(contents).toContain('print_command_error "posthog-cli hermes clone" "$CLONE_EXIT_CODE" "$CLI_CLONE_OUTPUT"')
    expect(contents).toContain(
      'print_command_error "posthog-cli hermes upload" "$UPLOAD_EXIT_CODE" "$CLI_UPLOAD_OUTPUT"'
    )
  })

  it('prefixes every captured posthog-cli failure line as an Xcode error', () => {
    const helperBlock = extractCommandErrorBlock()
    const script = `${helperBlock}
CLI_OUTPUT=$(printf '%s\\n%s\\n%s\\n' \
  '2026-06-04T20:42:06Z  INFO posthog_cli::utils::auth: Using token from environment' \
  '2026-06-04T20:42:07Z ERROR posthog_cli::commands: msg="Oops! real failure"' \
  'Oops! real failure')
print_command_error "posthog-cli hermes upload" "42" "$CLI_OUTPUT"`

    const output = execFileSync('/bin/bash', ['-c', script]).toString().trim().split('\n')

    expect(output).toEqual([
      'error: posthog-cli hermes upload failed with exit code 42',
      'error: posthog-cli hermes upload - 2026-06-04T20:42:06Z  INFO posthog_cli::utils::auth: Using token from environment',
      'error: posthog-cli hermes upload - 2026-06-04T20:42:07Z ERROR posthog_cli::commands: msg="Oops! real failure"',
      'error: posthog-cli hermes upload - Oops! real failure',
    ])
    expect(output.every((line) => line.startsWith('error: '))).toBe(true)
  })
})

describe('posthog-xcode.sh posthog-cli invocation', () => {
  // The wrapper reads `posthog-cli --version` once, to choose the release arguments and to check
  // the --release-mode floor. These stubs answer that without recording it, so the trace holds only
  // the clone and upload calls. The versions sit far either side of the real floor, so the tests
  // survive it being set.
  const cliStub = (version: string): string =>
    [
      '#!/bin/sh',
      `case " $* " in *" --version "*) echo "posthog-cli ${version}"; exit 0;; esac`,
      'echo "$@" >> "$CLI_TRACE_PATH"',
      '',
    ].join('\n')
  const CLI_NEW_ENOUGH = cliStub('9.9.9')
  const CLI_TOO_OLD = cliStub('0.0.1')
  // Reports no version, and records every call, the version probe included.
  const CLI_WITHOUT_VERSION = ['#!/bin/sh', 'echo "$@" >> "$CLI_TRACE_PATH"', ''].join('\n')

  // Runs the wrapper against a posthog-cli stub that records its arguments, so the assertions
  // are on what the CLI was actually asked to do rather than on the shell source.
  const runWrapper = (
    args: string[],
    extraEnv: Record<string, string>,
    infoPlist?: Record<string, string>,
    cli: string = CLI_NEW_ENOUGH,
    minVersion?: string
  ): { status: number; invocations: string[]; output: string } => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-xcode-release-mode-'))
    try {
      const derivedDir = path.join(tempDir, 'derived')
      const configurationDir = path.join(tempDir, 'configuration')
      const homeDir = path.join(tempDir, 'home')
      const iosDir = path.join(tempDir, 'ios')
      const cliTracePath = path.join(tempDir, 'cli.log')
      const cliPath = path.join(homeDir, '.posthog', 'posthog-cli')
      const reactNativePath = path.join(tempDir, 'react-native-xcode.sh')

      for (const directory of [derivedDir, configurationDir, iosDir, path.dirname(cliPath)]) {
        fs.mkdirSync(directory, { recursive: true })
      }
      fs.writeFileSync(cliPath, cli, { mode: 0o755 })
      fs.writeFileSync(reactNativePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 })

      const plistEnv: Record<string, string> = {}
      if (infoPlist) {
        const entries = Object.entries(infoPlist)
          .map(([key, value]) => `  <key>${key}</key>\n  <string>${value}</string>`)
          .join('\n')
        fs.mkdirSync(path.join(iosDir, 'App'), { recursive: true })
        fs.writeFileSync(
          path.join(iosDir, 'App', 'Info.plist'),
          `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${entries}\n</dict>\n</plist>\n`
        )
        plistEnv.SRCROOT = iosDir
        plistEnv.INFOPLIST_FILE = 'App/Info.plist'
      }

      // The shipped floor is a placeholder that blocks event mode outright. Substituting a real
      // one exercises the version comparison that goes live once the floor is filled in.
      let scriptPath = SCRIPT_PATH
      if (minVersion) {
        scriptPath = path.join(tempDir, 'posthog-xcode.sh')
        const patched = fs
          .readFileSync(SCRIPT_PATH, 'utf8')
          .replace('MIN_RELEASE_MODE_CLI_VERSION="TODO:PLACEHOLDER"', `MIN_RELEASE_MODE_CLI_VERSION="${minVersion}"`)
        fs.writeFileSync(scriptPath, patched, { mode: 0o755 })
      }

      const result = spawnSync(scriptPath, [...args, '/bin/sh', reactNativePath], {
        cwd: iosDir,
        env: {
          ...process.env,
          CLI_TRACE_PATH: cliTracePath,
          CONFIGURATION_BUILD_DIR: configurationDir,
          DERIVED_FILE_DIR: derivedDir,
          // Stands in for a CI runner so the wrapper skips deriving git metadata from the
          // (repo-less) temp directory.
          GITHUB_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          HOME: homeDir,
          NODE_BINARY: process.execPath,
          ...plistEnv,
          ...extraEnv,
        },
        encoding: 'utf8',
      })

      const invocations = fs.existsSync(cliTracePath)
        ? fs.readFileSync(cliTracePath, 'utf8').trim().split('\n').filter(Boolean)
        : []
      return { status: result.status ?? -1, invocations, output: `${result.stdout}${result.stderr}` }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }

  it.each([
    ['the POSTHOG_RELEASE_MODE env var', [] as string[], { POSTHOG_RELEASE_MODE: 'event' }],
    ['the --posthog-release-mode argument', ['--posthog-release-mode', 'event', '--'], {}],
  ])('passes --release-mode event to clone and upload from %s', (_source, args, env) => {
    const { status, invocations } = runWrapper(args, env, undefined, CLI_NEW_ENOUGH, '0.1.0')

    expect(status).toBe(0)
    expect(invocations).toHaveLength(2)
    expect(invocations[0]).toContain('hermes clone')
    expect(invocations[0]).toContain('--release-mode event')
    expect(invocations[1]).toContain('hermes upload')
    expect(invocations[1]).toContain('--release-mode event')
  })

  it('refuses event mode while the minimum version is still a placeholder', () => {
    const { status, invocations, output } = runWrapper([], { POSTHOG_RELEASE_MODE: 'event' })

    expect(status).not.toBe(0)
    expect(output).toContain('No release carries it yet')
    expect(output).toContain('PostHog/posthog#87660')
    expect(invocations.join('\n')).not.toContain('hermes')
  })

  it.each([
    ['is below the minimum', CLI_TOO_OLD, 'needs posthog-cli >='],
    ['reports no version at all', CLI_WITHOUT_VERSION, 'could not determine the posthog-cli version'],
  ])('names the upgrade when the posthog-cli on the box %s', (_case, cli, message) => {
    const { status, invocations, output } = runWrapper([], { POSTHOG_RELEASE_MODE: 'event' }, undefined, cli, '9.0.0')

    expect(status).not.toBe(0)
    expect(output).toContain(message)
    expect(output).toContain('npm install -g @posthog/cli@latest')
    // It fails before uploading anything, rather than part way through.
    expect(invocations.join('\n')).not.toContain('hermes')
  })

  it('reports the version it found so the message is actionable', () => {
    const { output } = runWrapper([], { POSTHOG_RELEASE_MODE: 'event' }, undefined, CLI_TOO_OLD, '9.0.0')

    expect(output).toContain('found 0.0.1')
  })

  it('skips the version check for a posthog-cli built from source', () => {
    const { status, invocations } = runWrapper(
      [],
      { POSTHOG_RELEASE_MODE: 'event', POSTHOG_SKIP_CLI_VERSION_CHECK: '1' },
      undefined,
      CLI_TOO_OLD
    )

    expect(status).toBe(0)
    expect(invocations).toHaveLength(2)
    expect(invocations[0]).toContain('--release-mode event')
  })

  it('omits the flag by default so an older posthog-cli keeps working', () => {
    const { status, invocations } = runWrapper([], { POSTHOG_RELEASE_MODE: '' }, undefined, CLI_WITHOUT_VERSION)

    expect(status).toBe(0)
    const uploads = invocations.filter((line) => line.includes('hermes'))
    expect(uploads).toHaveLength(2)
    expect(uploads.join('\n')).not.toContain('--release-mode')
  })

  it('fails the build on an unrecognized mode instead of binding the maps anyway', () => {
    const { status, invocations, output } = runWrapper([], { POSTHOG_RELEASE_MODE: 'evnet' })

    expect(status).not.toBe(0)
    expect(invocations).toHaveLength(0)
    expect(output).toContain("must be 'symbol-set' or 'event'")
  })

  // The SDK reports $app_version and $app_build from Info.plist, and event release mode resolves
  // an exception's release from exactly those. Expo writes literal versions there and leaves
  // MARKETING_VERSION at the Xcode template default of 1.0, so a release keyed on the build
  // setting never matches an event and the exception silently reports no release.
  it('keys the release on Info.plist rather than the build settings', () => {
    const { status, invocations } = runWrapper(
      [],
      {
        PRODUCT_BUNDLE_IDENTIFIER: 'com.example.app',
        MARKETING_VERSION: '1.0',
        CURRENT_PROJECT_VERSION: '1',
      },
      { CFBundleShortVersionString: '1.0.0', CFBundleVersion: '42' }
    )

    expect(status).toBe(0)
    expect(invocations[1]).toContain('--release-name com.example.app')
    expect(invocations[1]).toContain('--release-version 1.0.0')
    expect(invocations[1]).toContain('--build 42')
  })

  it('falls back to the build settings when Info.plist only references them', () => {
    const { status, invocations } = runWrapper(
      [],
      {
        PRODUCT_BUNDLE_IDENTIFIER: 'com.example.app',
        MARKETING_VERSION: '2.5.0',
        CURRENT_PROJECT_VERSION: '7',
      },
      { CFBundleShortVersionString: '$(MARKETING_VERSION)', CFBundleVersion: '$(CURRENT_PROJECT_VERSION)' }
    )

    expect(status).toBe(0)
    expect(invocations[1]).toContain('--release-version 2.5.0')
    expect(invocations[1]).toContain('--build 7')
  })

  it('falls back to the build settings when there is no Info.plist at all', () => {
    const { status, invocations } = runWrapper([], {
      PRODUCT_BUNDLE_IDENTIFIER: 'com.example.app',
      MARKETING_VERSION: '3.1.4',
      CURRENT_PROJECT_VERSION: '9',
    })

    expect(status).toBe(0)
    expect(invocations[1]).toContain('--release-version 3.1.4')
    expect(invocations[1]).toContain('--build 9')
  })
})

/**
 * The accepted release modes are written out four times: POSTHOG_RELEASE_MODES, the case in
 * posthog-xcode.sh, the list in posthog.gradle, and the case in the generated dSYM phase. A third
 * mode would be accepted at prebuild and then rejected at build time by whichever copy was missed.
 */
describe('release mode lists stay in sync', () => {
  const GRADLE_PATH = path.resolve(__dirname, '..', 'tooling', 'posthog.gradle')

  // Reads `  symbol-set|event) ;;` out of the case on $POSTHOG_RELEASE_MODE_VALUE.
  const shellModes = (): string[] => {
    const contents = fs.readFileSync(SCRIPT_PATH, 'utf8')
    const match = contents.match(/case "\$POSTHOG_RELEASE_MODE_VALUE" in\s*\n\s*([^)]+)\)/)
    if (!match) throw new Error('Could not locate the release mode case in posthog-xcode.sh')
    return match[1].split('|').map((mode) => mode.trim())
  }

  // Reads `["symbol-set", "event"]` out of resolvePostHogReleaseMode.
  const gradleModes = (): string[] => {
    const contents = fs.readFileSync(GRADLE_PATH, 'utf8')
    const match = contents.match(/value in \[([^\]]+)\]/)
    if (!match) throw new Error('Could not locate the release mode list in posthog.gradle')
    return match[1].split(',').map((mode) => mode.trim().replace(/"/g, ''))
  }

  // Reads the case labels out of the generated dSYM phase, dropping the `""` unset arm.
  const dsymModes = (): string[] => {
    const script = buildDsymUploadShellScript(false, false, undefined)
    const start = script.indexOf('case "$POSTHOG_RESOLVED_RELEASE_MODE" in')
    const end = script.indexOf('\n  *)', start)
    if (start === -1 || end === -1) throw new Error('Could not locate the release mode case in the dSYM phase')
    return [...script.slice(start, end).matchAll(/^ {2}([^)]+)\)/gm)]
      .flatMap((match) => match[1].split('|'))
      .map((mode) => mode.replace(/"/g, '').trim())
      .filter(Boolean)
  }

  it.each([
    ['posthog-xcode.sh', shellModes],
    ['posthog.gradle', gradleModes],
    ['the generated dSYM phase', dsymModes],
  ])('%s accepts exactly the modes the plugin does', (_name, extract) => {
    expect((extract as () => string[])().sort()).toEqual([...POSTHOG_RELEASE_MODES].sort())
  })

  // Both platforms gate event mode on the same posthog-cli, so raising one floor and forgetting
  // the other would leave one platform accepting a CLI the other rejects.
  it('gates both platforms on the same posthog-cli version', () => {
    const shell = fs.readFileSync(SCRIPT_PATH, 'utf8').match(/MIN_RELEASE_MODE_CLI_VERSION="([^"]+)"/)
    const gradle = fs.readFileSync(GRADLE_PATH, 'utf8').match(/MIN_RELEASE_MODE_VERSION = "([^"]+)"/)
    if (!shell || !gradle) throw new Error('Could not locate the release mode version floors')

    expect(shell[1]).toBe(gradle[1])
  })
})
