// copied from https://github.com/getsentry/sentry-react-native/blob/14f576eeb6c444281bff03a323b0aed836002cce/packages/core/src/js/tools/utils.ts

import * as crypto from 'crypto'
// eslint-disable-next-line import/no-extraneous-dependencies
import type { MixedOutput, Module, ReadOnlyGraph, SerializerOptions } from 'metro'
import type CountingSet from 'metro/src/lib/CountingSet' // types are in src but exports are in private
import countLines from './vendor/metro/countLines'

// Variant of MixedOutput
// https://github.com/facebook/metro/blob/9b85f83c9cc837d8cd897aa7723be7da5b296067/packages/metro/src/DeltaBundler/types.flow.js#L21
export type VirtualJSOutput = {
  type: 'js/script/virtual'
  data: {
    code: string
    lineCount: number
    map: []
  }
}

export type Bundle = {
  modules: Array<[id: number, code: string]>
  post: string
  pre: string
}

export type SerializedBundle = { code: string; map: string }

export type MetroSerializerOutput = string | SerializedBundle | Promise<string | SerializedBundle>

export type MetroSerializer = (
  entryPoint: string,
  premodules: ReadonlyArray<Module>,
  graph: ReadOnlyGraph,
  options: SerializerOptions
) => MetroSerializerOutput

/**
 * Returns minified Chunk ID code snippet.
 */
export function createDebugIdSnippet(debugId: string): string {
  return `!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._posthogChunkIds=e._posthogChunkIds||{},e._posthogChunkIds[n]="${debugId}")}catch(e){}}();`
}

/**
 * Deterministically hashes a string and turns the hash into a uuid.
 *
 * https://github.com/getsentry/sentry-javascript-bundler-plugins/blob/58271f1af2ade6b3e64d393d70376ae53bc5bd2f/packages/bundler-plugin-core/src/utils.ts#L174
 */
export function stringToUUID(str: string): string {
  const md5sum = crypto.createHash('md5')
  md5sum.update(str)
  const md5Hash = md5sum.digest('hex')

  // Position 16 is fixed to either 8, 9, a, or b in the uuid v4 spec (10xx in binary)
  // RFC 4122 section 4.4
  const v4variant = ['8', '9', 'a', 'b'][md5Hash.substring(16, 17).charCodeAt(0) % 4] as string

  return `${md5Hash.substring(0, 8)}-${md5Hash.substring(8, 12)}-4${md5Hash.substring(
    13,
    16
  )}-${v4variant}${md5Hash.substring(17, 20)}-${md5Hash.substring(20)}`.toLowerCase()
}

/**
 * Looks for an injected `_posthogChunkIds[n] = "debugId"` pattern
 * in the bundle source and extracts the `debugId` value from it.
 *
 * Matches both string and numeric keys for `n`, e.g.:
 *   _posthogChunkIds["abc"] = "1234"
 *   _posthogChunkIds[42] = "1234"
 */
export function determineDebugIdFromBundleSource(code: string): string | undefined {
  const match = code.match(/_posthogChunkIds\[\s*(?:(?:"[^"]*")|(?:'[^']*')|\d+)\s*\]\s*=\s*"([^"]+)"/)
  return match ? match[1] : undefined
}

/**
 * CountingSet was added in Metro 0.72.0 before that NodeJS Set was used.
 *
 * https://github.com/facebook/metro/blob/fc29a1177f883144674cf85a813b58567f69d545/packages/metro/src/lib/CountingSet.js
 */
function resolveSetCreator(): () => CountingSet<string> {
  const CountingSetFromPrivate = safeRequireCountingSetFromPrivate()
  if (CountingSetFromPrivate) {
    return () => new CountingSetFromPrivate.default()
  }

  const CountingSetFromSrc = safeRequireCountingSetFromSrc()
  if (CountingSetFromSrc) {
    return () => new CountingSetFromSrc.default()
  }

  return () => new Set() as unknown as CountingSet<string>
}

/**
 * CountingSet was added in Metro 0.72.0 before that NodeJS Set was used.
 *
 * https://github.com/facebook/metro/blob/fc29a1177f883144674cf85a813b58567f69d545/packages/metro/src/lib/CountingSet.js
 */
function safeRequireCountingSetFromSrc(): { default: new <T>() => CountingSet<T> } | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, import/no-extraneous-dependencies
    return require('metro/src/lib/CountingSet')
  } catch (e) {
    return undefined
  }
}

/**
 * CountingSet was moved to private in Metro 0.83.0. (all src exports were moved to private)
 *
 * https://github.com/facebook/metro/commit/ae6f42372ed361611b5672705f22081c2022cf28
 */
function safeRequireCountingSetFromPrivate(): { default: new <T>() => CountingSet<T> } | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, import/no-extraneous-dependencies
    return require('metro/private/lib/CountingSet')
  } catch (e) {
    return undefined
  }
}

export const createSet = resolveSetCreator()

const PRELUDE_MODULE_PATH = '__prelude__'

/**
 * Prepends the module after default required prelude modules.
 */
export function prependModule(
  modules: readonly Module<MixedOutput>[],
  module: Module<VirtualJSOutput>
): Module<MixedOutput>[] {
  const modifiedPremodules = [...modules]
  if (
    modifiedPremodules.length > 0 &&
    modifiedPremodules[0] !== undefined &&
    modifiedPremodules[0].path === PRELUDE_MODULE_PATH
  ) {
    // prelude module must be first as it measures the bundle startup time
    modifiedPremodules.unshift(modules[0] as Module<VirtualJSOutput>)
    modifiedPremodules[1] = module
  } else {
    modifiedPremodules.unshift(module)
  }
  return modifiedPremodules
}

/**
 * Creates a virtual JS module with the given path and code.
 */
export function createVirtualJSModule(
  modulePath: string,
  moduleCode: string
): Module<VirtualJSOutput> & { setSource: (code: string) => void } {
  let sourceCode = moduleCode

  return {
    setSource: (code: string) => {
      sourceCode = code
    },
    dependencies: new Map(),
    getSource: () => Buffer.from(sourceCode),
    inverseDependencies: createSet(),
    path: modulePath,
    output: [
      {
        type: 'js/script/virtual',
        data: {
          code: sourceCode,
          lineCount: countLines(sourceCode),
          map: [],
        },
      },
    ],
  }
}

/**
 * Tries to load Expo config using `@expo/config` package.
 */
export function getExpoConfig(projectRoot: string): Partial<{
  name: string
  version: string
}> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, import/no-extraneous-dependencies
    const expoConfig = require('@expo/config') as {
      getConfig?: (projectRoot: string) => { exp: Record<string, unknown> }
    }
    if (expoConfig.getConfig) {
      const { exp } = expoConfig.getConfig(projectRoot)
      return {
        name: typeof exp.name === 'string' && exp.name ? exp.name : undefined,
        version: typeof exp.version === 'string' && exp.version ? exp.version : undefined,
      }
    }
  } catch {
    // @expo/config not available, do nothing
  }

  return {}
}
