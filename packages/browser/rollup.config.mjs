import { getBabelOutputPlugin } from '@rollup/plugin-babel'
import { dts } from 'rolldown-plugin-dts'
import { minify as minifyWithTerser } from 'terser'
import { visualizer } from 'rollup-plugin-visualizer'
import { Features, transform as transformCss } from 'lightningcss'
import fs from 'fs'
import path from 'path'
import crossBundlePropertyConfig from './terser-cross-bundle-properties.cjs'
import { modernTransformOptions } from './oxc.config.mjs'

const { crossBundlePrivateProperties, globallyReservedPrivateProperties } = crossBundlePropertyConfig
const WRITE_MANGLED_PROPERTIES = process.env.WRITE_MANGLED_PROPERTIES
const BUILD_TYPES_ONLY = process.env.BUILD_TYPES_ONLY === '1'
const nameCachePath = './terser-mangled-names.json'
const nameCache = {}

// Shared across all entries so mangled property names are consistent between
// module.slim.js and extension-bundles.js — see #3313.
// Only property names (props) are shared; top-level variable names (vars) are
// reset by finalTerser before minifying each chunk since each module has its own scope.

// Rolldown renders chunks after renderChunk hooks, which would reformat @rollup/plugin-terser's output.
// Minify the final chunk instead and feed the existing map into Terser so source maps stay chained.
// Serialize calls because every runtime bundle must update the same property name cache atomically.
let finalTerserQueue
const finalTerser = (options) => ({
    name: 'terser',
    async generateBundle(outputOptions, bundle) {
        for (const file of Object.values(bundle)) {
            if (file.type !== 'chunk') {
                continue
            }
            let code = file.code
            let sourceMap = file.map
            if (outputOptions.format === 'iife' && sourceMap && file.fileName.includes('.es5.')) {
                // Babel's output plugin places helpers before Rolldown's IIFE. Wrap the complete output so
                // independently loaded bundles cannot overwrite each other's helpers on window.
                code = `!function(){\n${code}\n}();`
                sourceMap = { ...sourceMap, mappings: `;${sourceMap.mappings}` }
            }
            const minify = () => {
                nameCache.vars = { props: {} }
                return minifyWithTerser(code, {
                    ...options,
                    module: outputOptions.format === 'es',
                    sourceMap: outputOptions.sourcemap
                        ? { content: sourceMap, asObject: true, url: `${file.fileName}.map` }
                        : false,
                })
            }
            const resultPromise = finalTerserQueue ? finalTerserQueue.then(minify) : minify()
            finalTerserQueue = resultPromise.then(
                () => undefined,
                () => undefined
            )
            const result = await resultPromise
            file.code = result.code
            if (result.map) {
                result.map.ignoreList = result.map.sources.map((_, index) => index)
                result.map.x_google_ignoreList = result.map.ignoreList
                file.map = result.map
                const mapAsset = bundle[`${file.fileName}.map`]
                if (mapAsset?.type === 'asset') {
                    mapAsset.source = JSON.stringify(result.map)
                }
            }
        }
    },
})

const plugins = (es5, noExternal, preserveCrossBundleProperties, useBabel) => [
    {
        name: 'lightningcss',
        transform(code, id) {
            if (!id.endsWith('.css')) {
                return null
            }

            const result = transformCss({
                filename: id,
                code: Buffer.from(code),
                minify: true,
                // Match the previous PostCSS output by lowering nesting and media query ranges.
                include: Features.Nesting | Features.MediaQueries,
            })

            for (const warning of result.warnings) {
                this.warn(warning.message)
            }

            return {
                code: `export default ${JSON.stringify(result.code.toString())}`,
                map: { mappings: '' },
                moduleType: 'js',
            }
        },
    },
    // Oxc cannot emit ES5, and the slim/extension ABI checks need Babel's source-map names.
    // Transform after tree-shaking so unused Babel helpers do not remain as side effects.
    ...(useBabel
        ? [
              getBabelOutputPlugin({
                  allowAllFormats: true,
                  compact: true,
                  plugins: [
                      '@babel/plugin-transform-nullish-coalescing-operator',
                      // Explicitly included so we transform 1 ** 2 to Math.pow(1, 2) for ES6 compatibility
                      '@babel/plugin-transform-exponentiation-operator',
                  ],
                  presets: [
                      [
                          '@babel/preset-env',
                          {
                              loose: true,
                              modules: false,
                              exclude: ['transform-dynamic-import'],
                              targets: es5
                                  ? [
                                        '> 0.5%, last 2 versions, Firefox ESR, not dead',
                                        'chrome > 62',
                                        'firefox > 59',
                                        'ios_saf >= 6.1',
                                        'opera > 50',
                                        'safari > 12',
                                        'IE 11',
                                    ]
                                  : [
                                        '> 0.5%, last 2 versions, Firefox ESR, not dead',
                                        'chrome > 62',
                                        'firefox > 59',
                                        'ios_saf >= 10.3',
                                        'opera > 50',
                                        'safari > 12',
                                    ],
                          },
                      ],
                  ],
              }),
          ]
        : []),
    finalTerser({
        nameCache,
        toplevel: true,
        compress: {
            ecma: es5 ? 5 : 6,
            passes: 2,
            pure_getters: true,
            unsafe_methods: true,
            unsafe_comps: true,
            unsafe_math: true,
            unsafe_proto: true,
            unsafe_regexp: true,
        },
        format: {
            comments: false,
        },
        mangle:
            noExternal || es5
                ? {
                      // Don't mangle properties in no-external builds, as it is used in Browser extensions which have to go through a review process with e.g. Google, and they can be weird about obfuscated code.
                      // Don't mangle properties in the es5 build, as it relies on helpers which don't work well with mangling.
                      properties: false,
                      reserved: [
                          // we don't want to emit $ since that clashes with jquery
                          '$',
                      ],
                  }
                : {
                      // Note:
                      // PROPERTY MANGLING CAN BREAK YOUR CODE
                      // But we use it anyway because it's incredible for bundle size, you just need to develop with it in mind.
                      // Any properties that start with _ will be mangled, which can be a problem if anything with that pattern is
                      // part of the public interface, or if any API responses we use matches that regex.
                      // Fix specific instances of this by adding the property to the reserved list.
                      properties: {
                          regex: /^_(?!_)/, // only mangle properties that start with a single _
                          reserved: [
                              // list any exceptions that shouldn't be mangled, and please add an explanation:

                              // referenced in snippet, MUST be preserved
                              '_i',
                              '__SV',

                              // used in flags endpoint, MUST be preserved
                              '_',

                              // used in config
                              '_url',
                              '_batchKey',
                              // written by the separately built lazy recorder and read by capture(),
                              // so it must keep its literal name in every artifact
                              '_batchGroup',
                              '_noTruncate',
                              '_onCapture',

                              // passed from the exception extension bundle to legacy cores
                              '_noHeatmaps',

                              // used in surveys, however, this shouldn't be needed
                              // TODO: figure out how to remove them
                              '_posthog',
                              '_instance',
                              '_surveyEventReceiver',
                              // we don't mangle _surveyManager as it's used by external surveys to paint them on the dom directly
                              '_surveyManager',

                              // private ABI between independently emitted slim cores and extension bundles
                              ...(preserveCrossBundleProperties
                                  ? crossBundlePrivateProperties
                                  : globallyReservedPrivateProperties),

                              // used in conversations - external bundle needs to access these on the posthog instance
                              '_conversationsManager',
                              '_conversations',

                              // part of setup/teardown code, preserve these out of caution
                              '_init',
                              '_dom_loaded',
                              '_execute_array',
                              '_handle_unload',

                              // playwright uses these
                              '_forceAllowLocalhostNetworkCapture',
                              '_is_bot',
                              '__ph_loaded',
                              '_sessionActivityTimestamp',
                              '_sessionStartTimestamp',
                              '_sessionTimeoutMs',

                              // set on global window object (the ones using __ are not mangled anyway BUT be abundantly cautious)
                              '_POSTHOG_REMOTE_CONFIG',
                              '__POSTHOG_INSTRUMENTED__',
                              '__PosthogExtensions__',
                              '__posthog_wrapped__',
                              '__Posthog__',
                              '_patchFetch',
                              '_patchXHR',

                              // set as part of lazy-loading (doesn't start with _ BUT be abundantly cautious)
                              'loadExternalDependency',

                              // part of the public API (none start with _ so are not mangled anyway BUT be abundantly cautious)
                              'capture',
                              'identify',
                              'alias',
                              'set',
                              'set_once',
                              'set_config',
                              'register',
                              'register_once',
                              'unregister',
                              'opt_out_capturing',
                              'has_opted_out_capturing',
                              'opt_in_capturing',
                              'reset',
                              'isFeatureEnabled',
                              'onFeatureFlags',
                              'getSurveys',
                              'getActiveMatchingSurveys',
                              'captureException',
                              'posthog',
                              'version',
                              'surveys',
                              'calculateEventProperties',

                              // used by wrapper SDKs (e.g. posthog-flutter, posthog-react-native) to override $lib and $lib_version
                              '_overrideSDKInfo',

                              // possibly used by naughty users - we should decide if we want make these part of the public API, but be cautious for now
                              '_isIdentified',
                              '_is_bot',
                              '_calculate_event_properties', // deprecated in favour of calculateEventProperties

                              // URL parameters
                              '__posthog_debug',

                              // attribution params, not used in a way that would be mangled but be cautious
                              '_kx',

                              // used in rrweb source
                              '_rrweb',
                              '_root',
                              '_css',
                              '_opts',
                              '_cssText',
                              '__context',
                              '_mappings',
                              '_processor',
                              '_args',
                              '__ln',
                              '_unchangedStyles',
                              '__rrweb_original__',
                              '_Departed',
                              '_onload',
                              '_onclick',
                              '_oncontextmenu',
                              '_ondblclick',
                              '_onmousedown',
                              '_onmouseenter',
                              '_onmouseleave',
                              '_onmousemove',
                              '_onmouseout',
                              '_onmouseover',

                              // Helpers added by the e.g. es5 build. We don't use this, but they can be a starting point if we try to get the es5 build mangled in the future
                              '_invoke',
                              '__proto__',
                              '__await',
                              '_createClass',
                              '_classCallCheck',
                              '__esModule',
                              '__publicField2',
                              '__symbol__',

                              // found in terser-mangled-names.json and couldn't attribute source, so preserve out of caution,
                              '_sb',
                              '_mirror',
                              '_map',
                          ],
                      },
                      reserved: [
                          // we don't want to emit $ since that clashes with jquery
                          '$',
                      ],
                  },
    }),
    {
        name: 'save-terser-mangled-names',
        writeBundle() {
            if (!WRITE_MANGLED_PROPERTIES) {
                return
            }

            const names = new Set(
                Object.keys(nameCache.props.props).map((k) => {
                    // strip leading dollar to make operating on terser-mangled-names.json easier
                    if (!k.startsWith('$')) {
                        throw new Error('Unexpected format')
                    }
                    return k.substring(1)
                })
            )
            const sortedNames = [...names].sort()
            // save the props section to a file
            fs.writeFileSync(
                nameCachePath,
                JSON.stringify(
                    {
                        '//':
                            'THIS FILE IS AUTO_GENERATED BY rollup.config.js DO NOT EDIT IT DIRECTLY\n' +
                            'If a line has been added to this file after a build, it means that the terser mangler has added a new property to the list of mangled properties.\n' +
                            'CI will fail unless changes to this file are committed.\n' +
                            'Run a build with `WRITE_MANGLED_PROPERTIES=1 pnpm run build` and commit the new version of this file',
                        names: sortedNames,
                    },
                    null,
                    4
                ) + '\n'
            )
        },
    },
    {
        name: 'block-node-protocol-imports',
        resolveId(source) {
            if (source.startsWith('node:')) {
                // See https://posthog.slack.com/archives/C03P7NL6RMW/p1761119028457109 for context
                // Please don't fix this by adding a polyfill, instead use an approach which keeps the bundle size small, even if it means doing something bespoke.
                throw new Error(
                    `Node.js protocol import detected: "${source}". This will cause issues in browser/edge environments. Check the comments in rollup.config.mjs for details.`
                )
            }
            return null
        },
    },
]

const entryFilter = process.env.ENTRY
const allEntrypoints = fs.readdirSync('./src/entrypoints')
const entrypoints = entryFilter ? allEntrypoints.filter((file) => file.startsWith(entryFilter)) : allEntrypoints
// Bundles published under a named subpath (full/, no-external/, full/no-external/). Node reads
// dist/*.js as CommonJS because this package is not `type: module`, so requiring the ES module
// output throws. Each named subpath points `main` at a real CommonJS `.cjs` build instead.
// `posthog-js` itself already has one in dist/main.js.
const cjsBundles = new Set(['module.full', 'module.no-external', 'module.full.no-external'])

const entrypointTargets = entrypoints.map((file) => {
    const fileParts = file.split('.')
    // pop the extension
    fileParts.pop()

    let format = fileParts[fileParts.length - 1]
    // NOTE: Sadly we can't just use the file extensions as tsc won't compile things correctly
    if (['cjs', 'es', 'iife'].includes(format)) {
        fileParts.pop()
    } else {
        format = 'iife'
    }

    const fileName = fileParts.join('.')

    const preserveCrossBundleProperties = ['extension-bundles', 'module.slim'].includes(fileName)
    const useBabel =
        fileName.includes('es5') || ['extension-bundles', 'module.slim', 'module.slim.no-external'].includes(fileName)
    const pluginsForThisFile = plugins(
        fileName.includes('es5'),
        fileName.includes('no-external'),
        preserveCrossBundleProperties,
        useBabel
    )

    // we're allowed to console log in this file :)
    // oxlint-disable-next-line no-console
    console.log(`Building ${fileName} in ${format} format`)

    const outputVariants = [
        { extension: 'js', format },
        ...(format === 'es' && fileName === 'module' ? [{ extension: 'mjs', format: 'es' }] : []),
        // No source map for the CommonJS twin. It would describe the same sources as the ES module
        // map shipping beside it, and every npm install pays for both. Bundlers read `module`, so
        // the map they chain through is the ES module one; `require` consumers get our frames
        // ignore-listed anyway (see `sourcemapIgnoreList` below).
        ...(format === 'es' && cjsBundles.has(fileName) ? [{ extension: 'cjs', format: 'cjs', sourcemap: false }] : []),
    ]

    /** @type {import('rolldown').RolldownOptions} */
    return {
        input: `src/entrypoints/${file}`,
        platform: 'browser',
        ...(!useBabel ? { transform: modernTransformOptions } : {}),
        treeshake: {
            // @posthog/core is a pure utility package without package.json sideEffects metadata.
            // Declaring that here prevents unused barrel exports from being retained.
            moduleSideEffects: [{ test: /\/packages\/core\/dist\//, sideEffects: false }],
        },
        output: outputVariants.map(({ extension, format: outputFormat, sourcemap = true }) => ({
            file: `dist/${fileName}.${extension}`,
            sourcemap,
            // Mark every source in our bundles as third-party so devtools skip our frames.
            // Without this, wrappers we install on globals (most visibly the console capture
            // in entrypoints/logs.ts and rrweb's console plugin) become the reported location
            // of the caller's own `console.*` calls (e.g. everything blamed on `logs.ts`).
            // Rollup's default only ignore-lists paths containing node_modules, which misses
            // both our `src/` and workspace packages (they resolve through symlinks).
            sourcemapIgnoreList: () => true,
            format: outputFormat,
            ...(outputFormat === 'iife'
                ? {
                      name: 'posthog',
                      globals: {
                          preact: 'preact',
                      },
                  }
                : {}),
            ...(outputFormat === 'cjs' ? { exports: 'named' } : {}),
        })),
        plugins: [...pluginsForThisFile, visualizer({ filename: `bundle-stats-${fileName}.html`, gzipSize: true })],
    }
})

// Entries whose .d.ts must inline upstream types so
// consumers don't need a runtime dep on the re-exported package to resolve them.
const inlineExternalTypesEntries = new Set([
    'extension-bundles.es.ts',
    'posthog-recorder.ts',
    'recorder.ts',
    'rrweb.es.ts',
    'rrweb-types.es.ts',
    'rrweb-plugin-console-record.es.ts',
])

// Entries whose declarations use PostHog must reference the canonical class in
// module.d.ts instead of inlining a nominally incompatible copy.
const mainModuleTypesEntries = new Set([
    'conversations.ts',
    'customizations.es.ts',
    'dead-clicks-autocapture.ts',
    'main.cjs.ts',
    'product-tours-preview.es.ts',
    'product-tours.ts',
    'surveys-preview.es.ts',
    'surveys.ts',
    'tracing-headers.ts',
])

// rrdom's dts drops the local `RRNodeType` alias declaration; the renderChunk
// below rewrites value references back to `NodeType.`. Only rrweb pulls in rrdom.
const rewriteRrdomNodeTypeAlias = (file) => file === 'rrweb.es.ts'

// The former runtime TypeScript plugin also published dist/src declarations. Retain those paths.
const unbundledDeclarations = {
    name: 'unbundled-declarations',
    buildStart() {
        const directory = path.resolve('./lib/src')
        this.addWatchFile(directory)
        for (const file of fs.readdirSync(directory, { recursive: true })) {
            if (!file.endsWith('.d.ts')) {
                continue
            }
            const source = path.join(directory, file)
            this.addWatchFile(source)
            this.emitFile({
                type: 'asset',
                fileName: `src/${file.split(path.sep).join('/')}`,
                source: fs.readFileSync(source),
            })
        }
    },
}

const typeTargets = entrypoints
    .filter((file) => file.endsWith('.ts'))
    .map((file, index) => {
        const source = `./lib/src/entrypoints/${file.replace('.ts', '.d.ts')}`
        const isExtensionBundles = file === 'extension-bundles.es.ts'
        const isSlimModule = file === 'module.slim.es.ts'
        const referencesMainModuleTypes = mainModuleTypesEntries.has(file)
        const inlineExternalTypes = inlineExternalTypesEntries.has(file)
        const rewriteRrdomAlias = rewriteRrdomNodeTypeAlias(file)
        /** @type {import('rolldown').RolldownOptions} */
        return {
            input: source,
            // extension-bundles types must reference module.slim rather than inlining
            // their own copies — classes with private fields are nominally typed, so
            // duplicate declarations across .d.ts files are incompatible. For the same
            // reason, module.slim must use a source-level re-export from
            // module.slim.no-external and keep that module external here, so dts preserves
            // the reference instead of inlining a second declaration graph.
            external: (id) =>
                (isExtensionBundles && /module\.slim/.test(id)) ||
                (isSlimModule && /module\.slim\.no-external/.test(id)) ||
                (referencesMainModuleTypes && /posthog-core$/.test(id)) ||
                (!inlineExternalTypes && !id.startsWith('.') && !path.isAbsolute(id)),
            output: [
                {
                    dir: path.resolve('./dist'),
                    format: 'es',
                    entryFileNames: file.replace(/(?:\.(?:cjs|es|iife))?\.ts$/, '.d.ts'),
                },
            ],
            plugins: [
                ...(index === 0 ? [unbundledDeclarations] : []),
                ...dts({ dtsInput: true, emitDtsOnly: true }),
                // dts preserves tsc-era paths ending in `.es`, but the output files
                // omit that segment — fix references between the generated declarations.
                ...(isExtensionBundles || isSlimModule
                    ? [
                          {
                              name: 'fix-dts-external-paths',
                              renderChunk(code) {
                                  return code
                                      .replace(/\.\/module\.slim\.es(?=['"])/g, './module.slim')
                                      .replace(
                                          /\.\/module\.slim\.no-external\.es(?=['"])/g,
                                          './module.slim.no-external'
                                      )
                              },
                          },
                      ]
                    : []),
                ...(referencesMainModuleTypes
                    ? [
                          {
                              name: 'fix-main-module-dts-external-paths',
                              renderChunk(code) {
                                  // The external posthog-core import keeps its source-relative
                                  // path; point it at the canonical PostHog in dist/module.d.ts.
                                  return code.replace(/['"](?:\.\.\/)+posthog-core['"]/g, "'./module'")
                              },
                          },
                      ]
                    : []),
                ...(rewriteRrdomAlias
                    ? [
                          {
                              name: 'resolve-rrdom-rrnodetype-alias',
                              renderChunk(code) {
                                  // Value uses only; the property name `RRNodeType` (rrdom public API) must stay.
                                  return code.replace(/\bRRNodeType\./g, 'NodeType.')
                              },
                          },
                      ]
                    : []),
            ],
        }
    })

export default BUILD_TYPES_ONLY ? typeTargets : entrypointTargets
