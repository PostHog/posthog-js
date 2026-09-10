import { copyFileSync, writeFileSync } from 'node:fs';
import { dts } from '@posthog-tooling/rrweb-build';
import config from '../../vite.config.default';

export default config('src/index.ts', 'rrwebPluginCanvasWebRTCRecord', {
  generateDeclarations: false,
  plugins: process.argv.includes('--watch') ? [dts({
    insertTypesEntry: true,
    bundleTypes: true,
    afterBuild(emittedFiles) {
      // Keep watch declarations as self-contained as the production build.
      copyFileSync('src/simple-peer-light.d.ts', 'dist/simple-peer-light.d.ts');
      copyFileSync('src/simple-peer-light.d.ts', 'dist/simple-peer-light.d.cts');
      for (const [file, content] of emittedFiles) {
        const declaration = '/// <reference path="./simple-peer-light.d.ts" />\n' + content;
        writeFileSync(file, declaration);
        writeFileSync(file.replace(/\.d\.ts$/, '.d.cts'), declaration);
      }
    },
  })] : [],
});
