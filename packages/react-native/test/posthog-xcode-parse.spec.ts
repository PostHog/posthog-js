import { execFileSync, execSync } from 'child_process'
import * as fs from 'fs'
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

// Regression tests for issue #3682:
// The Expo plugin wraps the bundle phase as:
//   /bin/sh posthog-xcode.sh /bin/sh react-native-xcode.sh ...
// making $1 = /bin/sh inside posthog-xcode.sh.  REACT_NATIVE_XCODE then
// resolves to /bin/sh (a binary), so the grep/sed patch against it silently
// no-ops and the packager sourcemap is deleted before posthog-cli reads it.
describe('posthog-xcode.sh REACT_NATIVE_XCODE resolution', () => {
  const scriptContents = fs.readFileSync(SCRIPT_PATH, 'utf8')

  // Extract the REACT_NATIVE_XCODE_DEFAULT + resolution block from the script
  // so the tests track the actual source and cannot silently diverge from it.
  const extractAssignmentBlock = (): string => {
    // Match from REACT_NATIVE_XCODE_DEFAULT=... through the closing `fi` of
    // the if/else guard (or a plain assignment if the structure changes again).
    const match = scriptContents.match(
      /REACT_NATIVE_XCODE_DEFAULT="[^"]+"[\s\S]+?(?:fi|REACT_NATIVE_XCODE="\$\{[^}]+\}")/
    )
    if (!match) throw new Error('Could not locate REACT_NATIVE_XCODE assignment in posthog-xcode.sh')
    return match[0]
  }

  const resolveReactNativeXcode = (arg1: string): string => {
    const block = extractAssignmentBlock()
    // Run the extracted shell fragment with $1 set to the provided value and
    // print the resulting REACT_NATIVE_XCODE variable.
    const script = `${block}\nprintf '%s' "$REACT_NATIVE_XCODE"`
    const escaped = arg1.replace(/'/g, `'\\''`)
    return execSync(`/bin/bash -c 'set -- '"'"'${escaped}'"'"'; ${script}'`).toString()
  }

  it.each([
    ['RN script path', '../node_modules/react-native/scripts/react-native-xcode.sh'],
    ['/bin/sh (issue #3682 — Expo shell-prefixed bundle phase)', '/bin/sh'],
  ])('REACT_NATIVE_XCODE resolves to react-native-xcode.sh path when $1 is %s', (_desc, arg1) => {
    const result = resolveReactNativeXcode(arg1)
    expect(result).not.toBe('/bin/sh')
    expect(result).toContain('react-native-xcode.sh')
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
