import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { type EmailTemplateSource, withoutUndefinedParts } from './emails'

type Environment = Record<string, string | undefined>

interface GitCheckout {
  root: string
  repository?: string
  ref?: string
}

/** PostHog stores each source part in at most 400 characters and refuses a longer one. */
const MAX_PART_LENGTH = 400
const COMMIT_HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i
const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d+)?$/
const PATH_SEGMENT = /^[\w.-]+$/
/** A git file larger than this, or one that is not a regular file such as a pipe, is not read. */
const MAX_GIT_FILE_BYTES = 4 * 1024 * 1024
const VERCEL_HOSTS = new Map([
  ['github', 'github.com'],
  ['gitlab', 'gitlab.com'],
  ['bitbucket', 'bitbucket.org'],
])

const REPOSITORY_FROM_ENVIRONMENT: ((environment: Environment) => string | undefined)[] = [
  ({ GITHUB_SERVER_URL, GITHUB_REPOSITORY }) => repositoryOf(hostOfUrl(GITHUB_SERVER_URL), GITHUB_REPOSITORY),
  ({ CI_SERVER_HOST, CI_PROJECT_PATH }) => repositoryOf(CI_SERVER_HOST, CI_PROJECT_PATH),
  ({ VERCEL_GIT_PROVIDER, VERCEL_GIT_REPO_OWNER, VERCEL_GIT_REPO_SLUG }) =>
    repositoryOf(VERCEL_HOSTS.get(VERCEL_GIT_PROVIDER ?? ''), pathOf(VERCEL_GIT_REPO_OWNER, VERCEL_GIT_REPO_SLUG)),
  ({ RAILWAY_GIT_REPO_OWNER, RAILWAY_GIT_REPO_NAME }) =>
    repositoryOf('github.com', pathOf(RAILWAY_GIT_REPO_OWNER, RAILWAY_GIT_REPO_NAME)),
]
const REF_VARIABLES = ['GITHUB_SHA', 'CI_COMMIT_SHA', 'VERCEL_GIT_COMMIT_SHA', 'RAILWAY_GIT_COMMIT_SHA']
const WORKSPACE_VARIABLES = ['GITHUB_WORKSPACE', 'CI_PROJECT_DIR']

const checkouts = new Map<string, Promise<Omit<GitCheckout, 'root'>>>()

/**
 * Where a template file lives: the repository, the file's path in it and the commit. Each part comes from the
 * environment of a CI or hosting platform, then from the nearest git checkout above the file, which is read as
 * files without running git. A part that can't be found is left out, and nothing here ever throws.
 */
export async function templateSourceOf(
  file: string,
  environment: Environment = process.env
): Promise<EmailTemplateSource> {
  const checkout = await findCheckout(dirname(file))
  return withoutUndefinedParts({
    repository: firstOf(REPOSITORY_FROM_ENVIRONMENT, (detect) => detect(environment)) ?? checkout?.repository,
    path:
      (checkout && pathInside(checkout.root, file)) ??
      firstOf(WORKSPACE_VARIABLES, (variable) => pathInside(environment[variable], file)) ??
      pathFromWorkingDirectory(file),
    ref: firstOf(REF_VARIABLES, (variable) => commitHashOf(environment[variable])) ?? checkout?.ref,
  })
}

async function findCheckout(directory: string): Promise<GitCheckout | undefined> {
  for (let current = directory; ; current = dirname(current)) {
    const dotGit = join(current, '.git')
    const entry = await stat(dotGit).catch(() => undefined)
    if (entry) {
      return { root: current, ...(await readCheckout(dotGit, entry.isFile())) }
    }
    if (dirname(current) === current) {
      return undefined
    }
  }
}

function readCheckout(dotGit: string, isWorktreeLink: boolean): Promise<Omit<GitCheckout, 'root'>> {
  let checkout = checkouts.get(dotGit)
  if (!checkout) {
    checkout = gitDirectoriesOf(dotGit, isWorktreeLink).then(
      async ({ gitDirectory, commonDirectory }) => ({
        repository: await quietly(() => originRepository(commonDirectory)),
        ref: await quietly(() => headCommit(gitDirectory, commonDirectory)),
      }),
      () => ({})
    )
    checkouts.set(dotGit, checkout)
  }
  return checkout
}

/** A worktree's `.git` is a file naming its git directory, whose `commondir` names the shared one. */
async function gitDirectoriesOf(
  dotGit: string,
  isWorktreeLink: boolean
): Promise<{ gitDirectory: string; commonDirectory: string }> {
  const gitDirectory = isWorktreeLink ? await linkedGitDirectory(dotGit) : dotGit
  const commonDirectory = await readGitFile(join(gitDirectory, 'commondir')).then(
    (common) => resolve(gitDirectory, common.trim()),
    () => gitDirectory
  )
  return { gitDirectory, commonDirectory }
}

async function linkedGitDirectory(dotGitFile: string): Promise<string> {
  const link = /^gitdir:\s*(.+?)\s*$/m.exec(await readGitFile(dotGitFile))
  if (!link) {
    throw new Error('Not a git link file')
  }
  return resolve(dirname(dotGitFile), link[1])
}

async function originRepository(commonDirectory: string): Promise<string | undefined> {
  const url = originUrlOf(await readGitFile(join(commonDirectory, 'config')))
  return url === undefined ? undefined : repositoryOfRemote(url)
}

function originUrlOf(config: string): string | undefined {
  let inOrigin = false
  for (const line of config.split(/\r?\n/)) {
    const section = /^\s*\[\s*([^\s\]"]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/.exec(line)
    if (section) {
      inOrigin = section[1].toLowerCase() === 'remote' && section[2] === 'origin'
      continue
    }
    const url = inOrigin ? /^\s*url\s*=(.*)$/i.exec(line) : null
    if (url) {
      return configValueOf(url[1])
    }
  }
  return undefined
}

/** Git config values may be quoted, escape characters with a backslash, and end in a `#` or `;` comment. */
function configValueOf(raw: string): string {
  let value = ''
  let quoted = false
  for (let index = 0; index < raw.length; index++) {
    const character = raw[index]
    if (character === '\\') {
      const escaped = raw[++index] ?? ''
      value += { n: '\n', t: '\t', b: '\b' }[escaped] ?? escaped
    } else if (character === '"') {
      quoted = !quoted
    } else if (!quoted && (character === '#' || character === ';')) {
      break
    } else {
      value += character
    }
  }
  return value.trim()
}

/** Normalizes SSH, scp-like and HTTPS remotes to `host/owner/name`, keeping only the host and the path. */
function repositoryOfRemote(url: string): string | undefined {
  if (url.includes('://')) {
    const parsed = new URL(url)
    const isWeb = parsed.protocol === 'https:' || parsed.protocol === 'http:'
    const isSsh = ['ssh:', 'git:', 'git+ssh:', 'ssh+git:'].includes(parsed.protocol)
    return isWeb || isSsh ? repositoryOf(isWeb ? parsed.host : parsed.hostname, parsed.pathname) : undefined
  }
  const scpLike = /^(?:[^@/]*@)?([^@/:]+):(.+)$/.exec(url)
  return scpLike ? repositoryOf(scpLike[1], scpLike[2]) : undefined
}

async function headCommit(gitDirectory: string, commonDirectory: string): Promise<string | undefined> {
  const head = (await readGitFile(join(gitDirectory, 'HEAD'))).trim()
  const branch = /^ref:\s*(refs\/[^\s]+)$/.exec(head)?.[1]
  if (!branch) {
    return commitHashOf(head)
  }
  if (branch.split('/').includes('..')) {
    return undefined
  }
  for (const directory of new Set([gitDirectory, commonDirectory])) {
    const loose = await readGitFile(join(directory, branch)).catch(() => undefined)
    if (loose !== undefined) {
      return commitHashOf(loose.trim())
    }
  }
  const packedRefs = await readGitFile(join(commonDirectory, 'packed-refs'))
  for (const line of packedRefs.split(/\r?\n/)) {
    const [hash, name] = line.split(' ')
    if (name === branch) {
      return commitHashOf(hash)
    }
  }
  return undefined
}

async function readGitFile(path: string): Promise<string> {
  const entry = await stat(path)
  if (!entry.isFile() || entry.size > MAX_GIT_FILE_BYTES) {
    throw new Error(`Not a readable git file: ${path}`)
  }
  return readFile(path, 'utf8')
}

function repositoryOf(host: string | undefined, path: string | undefined): string | undefined {
  const normalizedHost = host?.trim().toLowerCase()
  const segments = path
    ?.trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/, '')
    .split('/')
  const isRepository =
    !!normalizedHost &&
    HOST.test(normalizedHost) &&
    !!segments &&
    segments.length >= 2 &&
    segments.every((segment) => PATH_SEGMENT.test(segment) && segment !== '.' && segment !== '..')
  return isRepository ? fitting(`${normalizedHost}/${segments.join('/')}`) : undefined
}

function hostOfUrl(url: string | undefined): string | undefined {
  return url ? quietlySync(() => new URL(url).host) : undefined
}

function pathOf(owner: string | undefined, name: string | undefined): string | undefined {
  return owner && name ? `${owner}/${name}` : undefined
}

function commitHashOf(value: string | undefined): string | undefined {
  const hash = value?.trim()
  return hash && COMMIT_HASH.test(hash) ? hash : undefined
}

function pathInside(directory: string | undefined, file: string): string | undefined {
  if (!directory) {
    return undefined
  }
  const inside = relative(directory, file)
  return inside && !inside.startsWith('..') && !isAbsolute(inside) ? fitting(inside.split(sep).join('/')) : undefined
}

function pathFromWorkingDirectory(file: string): string | undefined {
  return quietlySync(() => pathInside(process.cwd(), file)) ?? fitting(file)
}

function fitting(part: string): string | undefined {
  return part.length <= MAX_PART_LENGTH ? part : undefined
}

function firstOf<T>(candidates: T[], detect: (candidate: T) => string | undefined): string | undefined {
  for (const candidate of candidates) {
    const value = detect(candidate)
    if (value !== undefined) {
      return value
    }
  }
  return undefined
}

async function quietly<T>(work: () => Promise<T | undefined>): Promise<T | undefined> {
  return work().catch(() => undefined)
}

function quietlySync<T>(work: () => T | undefined): T | undefined {
  try {
    return work()
  } catch {
    return undefined
  }
}
