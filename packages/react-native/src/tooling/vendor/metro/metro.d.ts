// Type declarations for metro 0.73.x (used by Expo 48 / React Native 0.71.x)

declare module 'metro' {
  export interface MixedOutput {
    type: string
    data: {
      code: string
      lineCount?: number
      map?: unknown[]
      functionMap?: unknown
    }
  }

  export interface Module<T = MixedOutput> {
    dependencies: Map<string, { absolutePath: string }>
    getSource: () => Buffer
    inverseDependencies: Set<string>
    output: readonly T[]
    path: string
  }

  export interface ReadOnlyGraph<T = MixedOutput> {
    dependencies: ReadonlyMap<string, Module<T>>
    entryPoints: readonly string[]
    importBundleNames: ReadonlySet<string>
    transformOptions: {
      hot: boolean
      dev: boolean
      minify: boolean
      platform?: string | null
      type: string
      [key: string]: unknown
    }
  }

  export interface SerializerOptions {
    asyncRequireModulePath: string
    createModuleId: (path: string) => number
    dev: boolean
    getRunModuleStatement: (moduleId: string | number) => string
    includeAsyncPaths: boolean
    inlineSourceMap?: boolean
    modulesOnly: boolean
    processModuleFilter: (module: Module<MixedOutput>) => boolean
    projectRoot: string
    runBeforeMainModule: readonly string[]
    runModule: boolean
    serverRoot: string
    shouldAddToIgnoreList: (module: Module<MixedOutput>) => boolean
    sourceMapUrl?: string
    sourceUrl?: string
  }

  export interface BundleMetadata {
    pre: number
    post: number
    modules: [number, number][]
  }

  export interface MetroConfig {
    serializer?: {
      customSerializer?: (
        entryPoint: string,
        preModules: readonly Module<MixedOutput>[],
        graph: ReadOnlyGraph<MixedOutput>,
        options: SerializerOptions
      ) => Promise<string | { code: string; map: string }>
    }
    [key: string]: unknown
  }
}

declare module 'metro/src/DeltaBundler/Serializers/baseJSBundle' {
  import type { Module, ReadOnlyGraph, SerializerOptions } from 'metro'
  const baseJSBundle: (
    entryPoint: string,
    premodules: ReadonlyArray<Module>,
    graph: ReadOnlyGraph,
    options: SerializerOptions
  ) => {
    modules: [number, string][]
    post: string
    pre: string
  }
  export = baseJSBundle
}

declare module 'metro/src/lib/bundleToString' {
  import type { BundleMetadata } from 'metro'
  const bundleToString: (bundle: { modules: [number, string][]; post: string; pre: string }) => {
    code: string
    metadata: BundleMetadata
  }
  export = bundleToString
}

declare module 'metro/src/lib/countLines' {
  const countLines: (code: string) => number
  export = countLines
}

declare module 'metro/src/lib/CountingSet' {
  class CountingSet<T> extends Set<T> {
    constructor(items?: Iterable<T>)
  }
  export = CountingSet
}

declare module 'metro/src/DeltaBundler/Serializers/sourceMapString' {
  import type { MixedOutput, Module } from 'metro'
  const sourceMapString: (
    bundle: Module<MixedOutput>[],
    options: {
      excludeSource?: boolean
      processModuleFilter?: (module: Module<MixedOutput>) => boolean
      shouldAddToIgnoreList?: (module: Module<MixedOutput>) => boolean
    }
  ) => string
  export = sourceMapString
}
