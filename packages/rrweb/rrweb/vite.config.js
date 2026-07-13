import config from '../vite.config.default'
import { defineConfig } from 'vite'
import { mergeConfig } from 'vite'

// export default config('src/index.ts', 'rrweb', { outputDir: 'dist/main' });
const baseConfig = config('src/index.ts', 'rrweb')

export default defineConfig((configEnv) =>
    mergeConfig(baseConfig(configEnv), {
        plugins: [
            {
                name: 'move-worker-sourcemap',
                generateBundle(options, bundle) {
                    Object.entries(bundle).forEach(([fileName, output]) => {
                        if (fileName.includes('worker') && fileName.endsWith('.map')) {
                            console.log('Moving worker sourcemap:', fileName)
                            const newFileName = fileName.replace('assets/', '')
                            bundle[newFileName] = output
                            output.fileName = newFileName // Update the fileName property
                            delete bundle[fileName]
                        }
                    })
                },
            },
        ],
    })
)
