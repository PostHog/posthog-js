const { execFileSync } = require('node:child_process')
const {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs')
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

  // Keep each package's dependencies nested rather than hoisting them to the fixture root.
  linkDependency('@opentelemetry/api')
  linkDependency('@opentelemetry/exporter-trace-otlp-http')

  for (const tracePackage of ['@opentelemetry/sdk-trace-base', '@opentelemetry/sdk-trace']) {
    linkDependency(tracePackage)
    const absentPackage =
      tracePackage === '@opentelemetry/sdk-trace' ? '@opentelemetry/sdk-trace-base' : '@opentelemetry/sdk-trace'
    const assertStrictLayout = ['@opentelemetry/core', absentPackage]
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
        `${assertStrictLayout}\nconst { PostHogSpanProcessor } = require('@posthog/ai/otel'); new PostHogSpanProcessor({ projectToken: 'phc_test' }).shutdown().catch(error => { console.error(error); process.exitCode = 1 })`,
      ],
      { cwd: fixtureRoot, stdio: 'inherit' }
    )
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `const { PostHogSpanProcessor } = await import('@posthog/ai/otel'); await new PostHogSpanProcessor({ projectToken: 'phc_test' }).shutdown()`,
      ],
      { cwd: fixtureRoot, stdio: 'inherit' }
    )
    unlinkSync(join(fixtureRoot, 'node_modules', ...tracePackage.split('/')))
  }
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}
