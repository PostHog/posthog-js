import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'rolldown';
import { dts } from 'rolldown-plugin-dts';

function copyDeclarationsForCommonJs(): Plugin {
  return {
    name: 'copy-declarations-for-commonjs',
    writeBundle(outputOptions) {
      if (!outputOptions.dir) return;

      const declarationPath = path.resolve(outputOptions.dir, 'index.d.ts');
      copyFileSync(declarationPath, declarationPath.replace(/\.d\.ts$/, '.d.cts'));
    },
  };
}

export default defineConfig({
  input: 'src/index.ts',
  external: ['@posthog/rrweb'],
  output: {
    dir: 'dist',
    format: 'es',
  },
  plugins: [
    ...dts({
      emitDtsOnly: true,
      generator: 'oxc',
    }),
    copyDeclarationsForCommonJs(),
  ],
});
