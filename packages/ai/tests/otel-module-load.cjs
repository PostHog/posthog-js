const { execFileSync } = require('node:child_process')
const { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')

const packageRoot = join(__dirname, '..')
const fixtureRoot = mkdtempSync(join(tmpdir(), 'posthog-ai-otel-module-load-'))

function findPackageRoot(packageName) {
  let directory = dirname(require.resolve(packageName, { paths: [packageRoot] }))
  while (directory !== dirname(directory)) {
    try {
      const packageJson = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      if (packageJson.name === packageName) {
        return directory
      }
    } catch {
      // Keep walking up from the resolved entry point.
    }
    directory = dirname(directory)
  }
  throw new Error(`Could not find package root for ${packageName}`)
}

function linkDependency(packageName) {
  const destination = join(fixtureRoot, 'node_modules', ...packageName.split('/'))
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(findPackageRoot(packageName), destination, 'junction')
}

try {
  const installedPackage = join(fixtureRoot, 'node_modules', '@posthog', 'ai')
  mkdirSync(installedPackage, { recursive: true })
  cpSync(join(packageRoot, 'dist'), join(installedPackage, 'dist'), { recursive: true })
  writeFileSync(
    join(installedPackage, 'package.json'),
    JSON.stringify({
      name: '@posthog/ai',
      exports: {
        './otel': {
          require: './dist/otel/index.cjs',
          import: './dist/otel/index.mjs',
        },
      },
    })
  )

  // Reproduce a strict package-manager layout: only the OpenTelemetry packages
  // that both 2.x and 3.x apps install are available at @posthog/ai's level.
  // Their dependencies remain nested inside their own package layouts.
  // OpenTelemetry JS 3.x has no @opentelemetry/sdk-trace-base, so it is not linked.
  linkDependency('@opentelemetry/api')
  linkDependency('@opentelemetry/exporter-trace-otlp-http')

  const assertUndeclaredPackagesAreNotResolvable = ['@opentelemetry/core', '@opentelemetry/sdk-trace-base']
    .map(
      (name) => `
    try {
      require.resolve('${name}')
      throw new Error('${name} unexpectedly resolved from the fixture root')
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error
    }
  `
    )
    .join('\n')

  execFileSync(
    process.execPath,
    [
      '--eval',
      `${assertUndeclaredPackagesAreNotResolvable}\nnew (require('@posthog/ai/otel').PostHogSpanProcessor)({ projectToken: 'phc_test' })`,
    ],
    {
      cwd: fixtureRoot,
      stdio: 'inherit',
    }
  )
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const { PostHogSpanProcessor } = await import('@posthog/ai/otel'); new PostHogSpanProcessor({ projectToken: 'phc_test' })`,
    ],
    {
      cwd: fixtureRoot,
      stdio: 'inherit',
    }
  )
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}
