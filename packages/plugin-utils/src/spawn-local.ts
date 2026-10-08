import { spawn } from 'cross-spawn'

export interface CapturedRun {
    code: number | null
    stdout: string
    stderr: string
}

/**
 * Runs a command and captures both streams instead of inheriting them, for commands whose stdout
 * is a value the caller needs rather than build output. Resolves with a non-zero `code` rather
 * than rejecting, so the caller can shape the error from what the command wrote to stderr.
 */
export async function spawnLocalCapture(
    executable: string,
    args: string[],
    options: {
        env: NodeJS.ProcessEnv
        cwd: string
    }
): Promise<CapturedRun> {
    const child = spawn(executable, [...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: options.env,
        cwd: options.cwd,
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
    })

    return await new Promise<CapturedRun>((resolve, reject) => {
        child.on('close', (code) => resolve({ code, stdout, stderr }))
        child.on('error', (error) => reject(error))
    })
}

export async function spawnLocal(
    executable: string,
    args: string[],
    options: {
        env: NodeJS.ProcessEnv
        stdio: 'inherit' | 'ignore'
        cwd: string
        stdin?: string
    }
): Promise<void> {
    const stdioOption = options.stdin !== undefined ? ['pipe' as const, options.stdio, options.stdio] : options.stdio

    const child = spawn(executable, [...args], {
        stdio: stdioOption,
        env: options.env,
        cwd: options.cwd,
    })

    if (options.stdin !== undefined && child.stdin) {
        child.stdin.on('error', (err: any) => {
            if (err.code !== 'EPIPE') {
                throw err
            }
            // Swallow EPIPE: child may exit before consuming all stdin
        })
        child.stdin.write(options.stdin)
        child.stdin.end()
    }

    await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => {
            if (code === 0) {
                resolve()
            } else {
                reject(new Error(`Command failed with code ${code}`))
            }
        })

        child.on('error', (error) => {
            reject(error)
        })
    })
}
