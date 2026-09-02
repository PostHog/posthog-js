import path from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { copyFileSync } from 'node:fs';
import { build as esbuild } from 'esbuild';
import { umdWrapper } from 'esbuild-plugin-umd-wrapper';
import { resolve } from 'path';
import { ensureSourcemap } from '../vite.config.utils.ts';

// Plugin to generate UMD bundles using esbuild after vite build
function umdPlugin({ name, outDir }) {
  return {
    name: 'umd-plugin',
    async writeBundle(outputOptions, bundle) {
      for (const file of Object.values(bundle)) {
        const isJS =
          file.type === 'chunk' &&
          (file.fileName.endsWith('.js') || file.fileName.endsWith('.cjs'));
        if (file.type !== 'chunk' || !file.fileName.endsWith('.cjs')) {
          if (isJS) {
            ensureSourcemap(outputOptions.dir, file.fileName);
          }
          continue;
        }

        const inputFilePath = resolve(outputOptions.dir, file.fileName);
        const baseFileName = file.fileName.replace(/\.cjs$/, '');
        const outputFilePath = resolve(outputOptions.dir, baseFileName);

        // Determine library name based on filename
        let libraryName = name;
        if (baseFileName.includes('record')) {
          libraryName = 'rrwebSnapshotRecord';
        } else if (baseFileName.includes('replay')) {
          libraryName = 'rrwebSnapshotReplay';
        }

        await esbuild({
          entryPoints: [inputFilePath],
          outfile: `${outputFilePath}.umd.cjs`,
          minify: false,
          sourcemap: true,
          format: 'umd',
          target: 'es2017',
          treeShaking: true,
          bundle: true,
          plugins: [
            umdWrapper({
              libraryName: libraryName,
            }),
          ],
        });

        await esbuild({
          entryPoints: [inputFilePath],
          outfile: `${outputFilePath}.umd.min.cjs`,
          minify: true,
          sourcemap: true,
          format: 'umd',
          target: 'es2017',
          treeShaking: true,
          bundle: true,
          plugins: [
            umdWrapper({
              libraryName: libraryName,
            }),
          ],
        });

        console.log(`${outDir}/${baseFileName}.umd.cjs`);
        console.log(`${outDir}/${baseFileName}.umd.cjs.map`);
        console.log(`${outDir}/${baseFileName}.umd.min.cjs`);
        console.log(`${outDir}/${baseFileName}.umd.min.cjs.map`);
        ensureSourcemap(outputOptions.dir, file.fileName);
      }
    },
  };
}

export default defineConfig({
  build: {
    // Preserve Vite 6's browser support instead of adopting Vite 7/8's newer defaults.
    target: ['chrome87', 'edge88', 'firefox78', 'safari14'],
    lib: {
      entry: {
        'rrweb-snapshot': path.resolve(__dirname, 'src/index.ts'),
        'record': path.resolve(__dirname, 'src/record.ts'),
        'replay': path.resolve(__dirname, 'src/replay.ts'),
      },
      formats: ['es', 'cjs'],
    },
    outDir: 'dist',
    sourcemap: true,
    minify: false,
  },
  plugins: [
    dts({
      insertTypesEntry: true,
      bundleTypes: true,
      afterBuild: (emittedFiles) => {
        const files = Array.from(emittedFiles.keys());
        files.forEach((file) => {
          const ctsFile = file.replace('.d.ts', '.d.cts');
          copyFileSync(file, ctsFile);
        });
      },
    }),
    umdPlugin({ name: 'rrwebSnapshot', outDir: 'dist' }),
  ],
});
