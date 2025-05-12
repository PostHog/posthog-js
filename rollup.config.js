import babel from '@rollup/plugin-babel'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import { dts } from 'rollup-plugin-dts'
import terser from '@rollup/plugin-terser'
import { visualizer } from 'rollup-plugin-visualizer'
import commonjs from '@rollup/plugin-commonjs'
import postcss from 'rollup-plugin-postcss'
import postcssImport from 'postcss-import'
import postcssNesting from 'postcss-nesting'
import cssnano from 'cssnano'
import fs from 'fs'
import path from 'path'

// eslint-disable-next-line no-undef
const WRITE_MANGLED_PROPERTIES = process.env.WRITE_MANGLED_PROPERTIES
const nameCachePath = './terser-mangled-names.json'
let nameCache = {}

const plugins = (es5) => [
    json(),
    resolve({ browser: true }),
    typescript({ sourceMap: true, outDir: './dist' }),
    commonjs(),
    postcss({
        plugins: [
            postcssImport(),
            postcssNesting(),
            cssnano({
                preset: ['default', { discardComments: { removeAll: true } }],
            }),
        ],
        minimize: true,
        inject: false,
    }),
    babel({
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        babelHelpers: 'bundled',
        plugins: [
            '@babel/plugin-transform-nullish-coalescing-operator',
            // Explicitly included so we transform 1 ** 2 to Math.pow(1, 2) for ES6 compatability
            '@babel/plugin-transform-exponentiation-operator',
        ],
        presets: [
            [
                '@babel/preset-env',
                {
                    loose: true,
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
    terser({
        nameCache: WRITE_MANGLED_PROPERTIES ? nameCache : undefined, // using a shared nameCache leads to race conditions and broken builds, so don't use in general, only when writing the mangled names
        toplevel: true,
        compress: {
            ecma: es5 ? 5 : 6,
        },
        format: {
            comments: false,
        },
        mangle: es5
            ? true // Don't mangle properties in the es5 build, as it relies on helpers which don't work well with mangling.
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

                          // used in decide request, MUST be preserved
                          '_',

                          // used in config
                          '_url',
                          '_batchKey',
                          '_noTruncate',
                          '_onCapture',

                          // used in surveys, however, this shouldn't be needed
                          // TODO: figure out how to remove them
                          '_posthog',
                          '_instance',
                          '_surveyEventReceiver',

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

                          // possibly used by naughty users - we should decide if we want make these part of the public API, but be cautious for now
                          '_isIdentified',
                          '_is_bot',

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
              },
    }),
    {
        name: 'save-terser-mangled-names',
        writeBundle() {
            if (!WRITE_MANGLED_PROPERTIES) {
                return
            }

            const names = Object.keys(nameCache.props.props).map((k) => {
                // strip leading dollar to make operating on terser-mangled-names.json easier
                if (!k.startsWith('$')) {
                    throw new Error('Unexpected format')
                }
                return k.substring(1)
            })
            names.sort()
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
                        names,
                    },
                    null,
                    4
                ) + '\n'
            )
        },
    },
]

const entrypoints = fs.readdirSync('./src/entrypoints')

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

    const pluginsForThisFile = plugins(fileName.includes('es5'))

    // we're allowed to console log in this file :)
    // eslint-disable-next-line no-console
    console.log(`Building ${fileName} in ${format} format`)

    /** @type {import('rollup').RollupOptions} */
    return {
        input: `src/entrypoints/${file}`,
        output: [
            {
                file: `dist/${fileName}.js`,
                sourcemap: true,
                format,
                ...(format === 'iife'
                    ? {
                          name: 'posthog',
                          globals: {
                              preact: 'preact',
                          },
                      }
                    : {}),
                ...(format === 'cjs' ? { exports: 'auto' } : {}),
            },
        ],
        plugins: [...pluginsForThisFile, visualizer({ filename: `bundle-stats-${fileName}.html`, gzipSize: true })],
    }
})

const typeTargets = entrypoints
    .filter((file) => file.endsWith('.es.ts'))
    .map((file) => {
        const source = `./lib/src/entrypoints/${file.replace('.ts', '.d.ts')}`
        /** @type {import('rollup').RollupOptions} */
        return {
            input: source,
            output: [
                {
                    dir: path.resolve('./dist'),
                    entryFileNames: file.replace('.es.ts', '.d.ts'),
                },
            ],
            plugins: [
                json(),
                dts({
                    exclude: [],
                }),
            ],
        }
    })

export default [...entrypointTargets, ...typeTargets]
