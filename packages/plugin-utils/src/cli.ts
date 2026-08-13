import { ResolvedPluginConfig } from './config'
import { spawnLocal } from './spawn-local'

/**
 * `process` injects chunk ids into the built files on disk and uploads them.
 * `upload` only reads the files, expecting chunk ids to already be present
 * (e.g. injected in-memory by a bundler plugin before the files were written).
 */
export type SourcemapCliCommand = 'process' | 'upload'

/**
 * Build CLI arguments for `posthog-cli sourcemap <command>`.
 */
export function buildSourcemapCliArgs(
    config: ResolvedPluginConfig,
    mode: { stdin: true } | { directory: string },
    command: SourcemapCliCommand = 'process'
): string[] {
    const args = ['sourcemap', command]

    if ('stdin' in mode) {
        args.push('--stdin')
    } else {
        args.push('--directory', mode.directory)
    }

    if (config.sourcemaps.releaseName) {
        args.push('--release-name', config.sourcemaps.releaseName)
    }

    if (config.sourcemaps.releaseVersion) {
        args.push('--release-version', config.sourcemaps.releaseVersion)
    }

    if (config.sourcemaps.build !== undefined && config.sourcemaps.build !== '') {
        args.push('--build', config.sourcemaps.build)
    }

    // On `upload` the caller owns map deletion: `--delete-after` also rewrites
    // the .js files (stripping sourcemap references), and callers pick `upload`
    // precisely because the written files must not change — e.g. Subresource
    // Integrity hashes were already computed from them.
    if (config.sourcemaps.deleteAfterUpload && command === 'process') {
        args.push('--delete-after')
    }

    if (config.sourcemaps.batchSize) {
        args.push('--batch-size', config.sourcemaps.batchSize.toString())
    }

    return args
}

/**
 * Build environment variables for CLI invocation.
 * Plugin config values override any existing process.env values.
 */
export function buildCliEnv(config: ResolvedPluginConfig): NodeJS.ProcessEnv {
    return {
        ...process.env,
        RUST_LOG: `posthog_cli=${config.logLevel}`,
        POSTHOG_CLI_HOST: config.host,
        POSTHOG_CLI_API_KEY: config.personalApiKey,
        POSTHOG_CLI_PROJECT_ID: config.projectId,
    }
}

/**
 * Spawn the PostHog CLI for sourcemap processing via stdin (file list).
 */
export async function runSourcemapCli(
    config: ResolvedPluginConfig,
    options: ({ filePaths: string[] } | { directory: string }) & { command?: SourcemapCliCommand }
): Promise<void> {
    const mode = 'filePaths' in options ? { stdin: true as const } : { directory: options.directory }
    const args = buildSourcemapCliArgs(config, mode, options.command ?? 'process')
    const env = buildCliEnv(config)

    const spawnOptions: Parameters<typeof spawnLocal>[2] = {
        cwd: process.cwd(),
        env,
        stdio: 'inherit',
    }

    if ('filePaths' in options) {
        spawnOptions.stdin = options.filePaths.join('\n') + '\n'
    }

    await spawnLocal(config.cliBinaryPath, args, spawnOptions)
}
