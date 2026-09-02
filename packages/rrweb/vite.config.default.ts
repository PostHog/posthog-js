/// <reference types="vite/client" />
import dts from 'vite-plugin-dts';
import { copyFileSync } from 'node:fs';
import { defineConfig, LibraryOptions, LibraryFormats, Plugin } from 'vite';
import { build, Format } from 'esbuild';
import { resolve } from 'path';
import { umdWrapper } from 'esbuild-plugin-umd-wrapper';
import { visualizer } from 'rollup-plugin-visualizer';
import { ensureSourcemap } from './vite.config.utils.ts';

// don't empty out dir if --watch flag is passed
const emptyOutDir = !process.argv.includes('--watch');

function minifyAndUMDPlugin({
  name,
  outDir,
}: {
  name: LibraryOptions['name'];
  outDir: string;
}): Plugin {
  return {
    name: 'minify-plugin',
    async writeBundle(outputOptions, bundle) {
      for (const file of Object.values(bundle)) {
        const isCSS = file.type === 'asset' && file.fileName.endsWith('.css');
        const isCJS =
          file.type === 'chunk' && file.isEntry && file.fileName.endsWith('.cjs');
        const isJS =
          file.type === 'chunk' &&
          (file.fileName.endsWith('.js') || file.fileName.endsWith('.cjs'));
        if (!isCSS && !isCJS) {
          if (isJS) {
            ensureSourcemap(outputOptions.dir!, file.fileName);
          }
          continue;
        }

        const inputFilePath = resolve(outputOptions.dir!, file.fileName);
        const baseFileName = file.fileName.replace(/(\.cjs|\.css)$/, '');
        const outputFilePath = resolve(outputOptions.dir!, baseFileName);
        // console.log(outputFilePath, 'minifying', file.fileName);
        if (isCSS) {
          await buildFile({
            input: inputFilePath,
            output: `${outputFilePath}.min.css`,
            minify: true,
            isCss: true,
            outDir,
          });
        } else {
          await buildFile({
            name,
            input: inputFilePath,
            output: `${outputFilePath}.umd.cjs`,
            minify: false,
            isCss: false,
            outDir,
          });
          await buildFile({
            name,
            input: inputFilePath,
            output: `${outputFilePath}.umd.min.cjs`,
            minify: true,
            isCss: false,
            outDir,
          });
          ensureSourcemap(outputOptions.dir!, file.fileName);
        }
      }
    },
  };
}

async function buildFile({
  name,
  input,
  output,
  minify,
  isCss,
  outDir,
}: {
  name?: LibraryOptions['name'];
  input: string;
  output: string;
  outDir: string;
  minify: boolean;
  isCss: boolean;
}) {
  await build({
    entryPoints: [input],
    outfile: output,
    minify,
    sourcemap: true,
    format: isCss ? undefined : ('umd' as Format),
    target: isCss ? undefined : 'es2017',
    treeShaking: !isCss,
    plugins: [
      umdWrapper({
        libraryName: name,
      }),
    ],
  });
  const filename = output.replace(new RegExp(`^.+/(${outDir}/)`), '$1');
  console.log(filename);
  console.log(`${filename}.map`);
}

export default function (
  entry: LibraryOptions['entry'],
  name: LibraryOptions['name'],
  options?: {
    outputDir?: string;
    fileName?: string;
    plugins?: Plugin[];
    generateDeclarations?: boolean;
    external?: string[];
  },
) {
  const {
    fileName,
    outputDir: outDir = 'dist',
    plugins = [],
    generateDeclarations = true,
    external = [],
  } = options || {};

  let formats: LibraryFormats[] = ['es', 'cjs'];

  return defineConfig(() => ({
    // Inline workers run from blob URLs, so relative source map URLs cannot resolve.
    worker: {
      plugins: () => [
        {
          name: 'disable-inline-worker-sourcemaps',
          outputOptions(options) {
            return { ...options, sourcemap: false };
          },
        },
      ],
    },
    build: {
      // Preserve Vite 6's browser support instead of adopting Vite 7/8's newer defaults.
      target: ['chrome87', 'edge88', 'firefox78', 'safari14'],

      // See https://vite.dev/guide/build.html#library-mode
      lib: {
        cssFileName: 'style',
        entry,
        name,
        fileName,
        // TODO: turn on `umd` for rrweb when https://github.com/schummar/vite/tree/feature/libMultiEntryUMD gets merged
        // More info: https://github.com/vitejs/vite/pull/7047#issuecomment-1288080855
        // formats: ['es', 'umd', 'cjs'],
        formats,
      },

      outDir,

      emptyOutDir,

      rolldownOptions: {
        external,
        output: {
          exports: 'named',
        },
      },

      // Leaving this unminified so you can see what exactly gets included in
      // the bundles
      minify: false,

      sourcemap: true,
    },
    plugins: [
      generateDeclarations &&
        dts({
          insertTypesEntry: true,
          bundleTypes: true,
          afterBuild: (emittedFiles: Map<string, string>) => {
            // To pass publint (`npm x publint@latest`) and ensure the
            // package is supported by all consumers, we must export types that are
            // read as ESM. To do this, there must be duplicate types with the
            // correct extension supplied in the package.json exports field.
            const files: string[] = Array.from(emittedFiles.keys());
            files.forEach((file) => {
              const ctsFile = file.replace('.d.ts', '.d.cts');
              copyFileSync(file, ctsFile);
            });
          },
        }),
      minifyAndUMDPlugin({ name, outDir }),
      visualizer({
        filename: resolve(__dirname, name + '-bundle-analysis.html'), // Path for the HTML report
        open: false, // don't Automatically open the report in the browser
      }),
      ...plugins,
    ],
  }));
}
