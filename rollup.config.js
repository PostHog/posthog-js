import resolve from '@rollup/plugin-node-resolve'

export default {
    plugins: [
        resolve({
            browser: true,
            main: true,
            jsnext: true,
        }),
    ],
}
