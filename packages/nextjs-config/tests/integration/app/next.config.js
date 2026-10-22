/* oxlint-disable typescript/no-require-imports -- Exercise Next's CommonJS config loader and package exports. */
const { withPostHogConfig } = require('@posthog/nextjs-config')
const fs = require('node:fs')
const path = require('node:path')
const major = Number(require('next/package.json').version.split('.')[0])
const resolve = withPostHogConfig(
  (phase) => ({
    experimental: {
      cpus: 1,
      webpackBuildWorker: true,
      ...(major < 15 ? { serverComponentsExternalPackages: ['posthog-node'] } : {}),
    },
    ...(major >= 15 ? { serverExternalPackages: ['posthog-node'] } : {}),
    distDir: phase === 'phase-development-server' ? '.next-dev' : '.next',
    // Do not rely on changing Next's build ID to invalidate assets.
    generateBuildId: async () => 'integration-build',
  }),
  {
    personalApiKey: 'phx_integration',
    projectId: '1',
    cliBinaryPath: path.join(__dirname, 'mock-cli.cjs'),
    sourcemaps: { releaseMode: 'event', deleteAfterUpload: true },
  }
)

module.exports = async (...args) => {
  const config = await resolve(...args)
  const metadata = {
    phase: args[0],
    pid: process.pid,
    argv: process.argv,
    devWorker: process.env.NEXT_PRIVATE_WORKER,
    buildWorker: process.env.NEXT_PRIVATE_BUILD_WORKER,
    turbopack: process.env.TURBOPACK,
    webpack: process.env.WEBPACK,
    nativeDebugIds: config.turbopack?.debugIds,
    uploadHook: !!config.compiler?.runAfterProductionCompile,
  }
  const log = (event) =>
    fs.appendFileSync(process.env.FIXTURE_WORKER_LOG, JSON.stringify({ ...metadata, ...event }) + '\n')
  const hook = config.webpack
  log({ event: 'config', hasWebpackHook: !!hook })
  if (hook)
    config.webpack = (webpackConfig, options) => {
      const result = hook(webpackConfig, options)
      log({
        event: 'webpack',
        target: options.nextRuntime || 'client',
        plugins: result.plugins.filter((plugin) => plugin?.constructor.name === 'PosthogWebpackPlugin').length,
      })
      return result
    }
  return config
}
