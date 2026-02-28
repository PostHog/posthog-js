import { spawn } from 'cross-spawn'

const MAX_RETRIES = 5
const MAX_RETRY_DELAY_MS = 1000

// Patterns in stderr that indicate a transient race condition when multiple
// parallel builds try to download the posthog-cli binary at the same time.
const RETRYABLE_STDERR_PATTERNS = [/errno: -88/, /code: 'Unknown system error -88'/, /code: 'ETXTBSY'/, /errno: -26/]

async function spawnOnce(
  executable: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv
    stdio: 'inherit' | 'ignore'
    cwd: string
  }
): Promise<void> {
  // Pipe stderr so we can inspect it for retryable patterns. On non-retryable
  // failure it is forwarded to process.stderr so the caller still sees it.
  const child = spawn(executable, [...args], {
    stdio: [options.stdio ?? 'inherit', options.stdio ?? 'inherit', 'pipe'],
    env: options.env,
    cwd: options.cwd,
  })

  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  return new Promise<void>((resolve, reject) => {
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(stderr))
      }
    })

    child.on('error', reject)
  })
}

export async function spawnLocal(
  executable: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv
    stdio: 'inherit' | 'ignore'
    cwd: string
  }
): Promise<void> {
  let lastError: unknown

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await spawnOnce(executable, args, options)
      return
    } catch (error) {
      lastError = error
      const stderr = error instanceof Error ? error.message : ''
      if (attempt < MAX_RETRIES && RETRYABLE_STDERR_PATTERNS.some((p) => p.test(stderr))) {
        const delay = Math.floor(Math.random() * MAX_RETRY_DELAY_MS)
        console.warn(
          `[posthog] spawnLocal: retrying after transient error (attempt ${attempt + 1}/${MAX_RETRIES}, delay ${delay}ms)`
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
      } else {
        if (stderr) process.stderr.write(stderr)
        break
      }
    }
  }

  throw lastError
}
