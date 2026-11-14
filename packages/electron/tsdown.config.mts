import { defineConfig, type UserConfig } from 'tsdown'

const entries = {
    main: 'src/main/index.ts',
    renderer: 'src/renderer/index.ts',
    preload: 'src/preload/index.ts',
    'preload-helper': 'src/preload/helper.ts',
}

export default defineConfig(
    Object.entries(entries).map(([name, path]): UserConfig => ({
        entry: { [name]: path },
        format: ['esm', 'cjs'],
        platform: 'neutral',
        target: 'es2022',
        dts: true,
        sourcemap: true,
        clean: false,
        deps: { neverBundle: true },
        outExtensions: ({ format }) => ({ js: format === 'es' ? '.mjs' : '.cjs', dts: '.d.ts' }),
        outputOptions: { codeSplitting: false, exports: 'named' },
    }))
)
