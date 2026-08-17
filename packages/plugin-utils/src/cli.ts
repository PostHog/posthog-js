import { ResolvedPluginConfig } from './config'
import { spawnLocal, spawnLocalCapture } from './spawn-local'

/**
 * `process` injects chunk ids into the built files on disk and uploads them.
 * `upload` only reads the files, expecting chunk ids to already be present
 * (e.g. injected in-memory by a bundler plugin before the files were written).
 */
export type SourcemapCliCommand = 'process' | 'upload'

/**
 * The flags identifying which release this build belongs to. Shared by every command that
 * resolves one, so `release resolve` lands on the same release row the upload would have.
 */
function buildReleaseArgs(config: ResolvedPluginConfig): string[] {
    const args: string[] = []

    if (config.sourcemaps.releaseName) {
        args.push('--release-name', config.sourcemaps.releaseName)
    }

    if (config.sourcemaps.releaseVersion) {
        args.push('--release-version', config.sourcemaps.releaseVersion)
    }

    if (config.sourcemaps.build !== undefined && config.sourcemaps.build !== '') {
        args.push('--build', config.sourcemaps.build)
    }

    return args
}

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

    args.push(...buildReleaseArgs(config))

    // Only passed in event mode, so a symbol-set build keeps working against a posthog-cli
    // predating the flag.
    if (config.sourcemaps.releaseMode === 'event') {
        args.push('--release-mode', 'event')
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

/**
 * Resolves the release this build belongs to, creating it if it doesn't exist yet, and returns its
 * id for injection into the chunks. Returns undefined when nothing identifies a release: the CLI
 * prints nothing and exits zero for a build with no release name/version and no git or CI
 * metadata to derive them from, which is a build that ships without a release rather than a
 * failure.
 */
export async function resolveReleaseId(config: ResolvedPluginConfig): Promise<string | undefined> {
    const args = ['release', 'resolve', ...buildReleaseArgs(config)]
    const { code, stdout, stderr } = await spawnLocalCapture(config.cliBinaryPath, args, {
        cwd: process.cwd(),
        env: buildCliEnv(config),
    })

    if (code !== 0) {
        // `release resolve` shipped after `sourcemap upload`, so an older binary on the PATH
        // fails here rather than at upload time, where the message would make more sense.
        const hint = /unrecognized subcommand|unexpected argument/.test(stderr)
            ? ` Event release mode needs a posthog-cli with 'release resolve' (${config.cliBinaryPath}).`
            : ''
        throw new Error(`posthog-cli release resolve failed with code ${code}.${hint}\n${stderr.trim()}`)
    }

    // The CLI logs to stderr and prints only the id to stdout, so forward its warnings rather
    // than swallowing them with the captured stream.
    if (stderr.trim()) {
        process.stderr.write(stderr)
    }

    return stdout.trim() || undefined
}
