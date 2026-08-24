import { execFileSync, execSync, spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

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

describe('posthog-xcode.sh skipOnConflict upload flag', () => {
  it('passes --skip-on-conflict only to hermes upload', () => {
    const contents = fs.readFileSync(SCRIPT_PATH, 'utf8')

    expect(contents).toContain('POSTHOG_UPLOAD_ARGS="$POSTHOG_UPLOAD_ARGS --skip-on-conflict"')
    expect(contents).toContain(
      'CLI_UPLOAD_OUTPUT=$(/bin/sh -c "$PH_CLI_PATH hermes upload --directory $DERIVED_FILE_DIR $CLI_RELEASE_ARGS $POSTHOG_UPLOAD_ARGS" 2>&1)'
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
  // Runs the wrapper against a posthog-cli stub that records its arguments, so the assertions
  // are on what the CLI was actually asked to do rather than on the shell source.
  const runWrapper = (
    args: string[],
    extraEnv: Record<string, string>,
    infoPlist?: Record<string, string>
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
      fs.writeFileSync(cliPath, '#!/bin/sh\necho "$@" >> "$CLI_TRACE_PATH"\n', { mode: 0o755 })
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

      const result = spawnSync(SCRIPT_PATH, [...args, '/bin/sh', reactNativePath], {
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
