import resolve from '@rollup/plugin-node-resolve'
import json from '@rollup/plugin-json'

export default {
    plugins: [
        json(),
        resolve({
            browser: true,
            main: true,
            jsnext: true,
        }),
    ],
}
