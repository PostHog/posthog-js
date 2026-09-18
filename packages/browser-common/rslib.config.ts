import { defineConfig } from '@rslib/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { Features, transform as transformCss } from 'lightningcss'

const packageVersion = (
    JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
).version

export default defineConfig({
    lib: [
        { format: 'esm', syntax: 'es2023', dts: true, bundle: false },
        { format: 'cjs', syntax: 'es2023', dts: true, bundle: false },
    ],
    plugins: [pluginReact({ fastRefresh: false, swcReactOptions: { runtime: 'automatic', importSource: 'preact' } })],
    source: {
        define: {
            __BROWSER_COMMON_VERSION__: JSON.stringify(packageVersion),
            __SURVEY_CSS__: JSON.stringify(
                transformCss({
                    filename: 'survey.css',
                    code: readFileSync(new URL('./src/surveys/survey.css', import.meta.url)),
                    minify: true,
                    include: Features.Nesting | Features.MediaQueries,
                }).code.toString()
            ),
        },
        entry: {
            index: ['src/**/*', '!src/__tests__/**/*', '!src/**/*.spec.ts'],
        },
        tsconfigPath: './tsconfig.build.json',
    },
})
