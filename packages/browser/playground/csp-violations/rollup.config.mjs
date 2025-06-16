import 'dotenv/config'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import replace from '@rollup/plugin-replace'

const prod = process.env.NODE_ENV === 'production'

export default {
    input: {
        posthog: 'src/posthog.js',
        main: 'src/main.js',
    },
    output: {
        dir: 'dist',
        sourcemap: !prod,
    },
    plugins: [
        replace({
            preventAssignment: true,
            'process.env.POSTHOG_TOKEN': JSON.stringify(process.env.POSTHOG_TOKEN),
            'process.env.POSTHOG_API_HOST': JSON.stringify(process.env.POSTHOG_API_HOST),
            'process.env.POSTHOG_UI_HOST': JSON.stringify(process.env.POSTHOG_UI_HOST),
        }),
        resolve(),
        commonjs(),
    ],
}
