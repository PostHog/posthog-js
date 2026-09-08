import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'rolldown';
import { dts } from 'rolldown-plugin-dts';

function copyDeclarationsForCommonJs(): Plugin {
  return {
    name: 'copy-declarations-for-commonjs',
    writeBundle(outputOptions, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (fileName.endsWith('.d.ts')) {
          const declarationPath = path.resolve(outputOptions.dir!, fileName);
          copyFileSync(declarationPath, declarationPath.replace(/\.d\.ts$/, '.d.cts'));
        }
      }
    },
  };
}

export default function declarations(
  entries: Record<string, string> = { index: 'src/index.ts' },
) {
  // Keep each entry self-contained so its .d.cts copy never imports an ESM-only shared chunk.
  return defineConfig(Object.entries(entries).map(([name, entry]) => ({
    input: { [name]: path.resolve(entry) },
    external: (id: string) => !id.startsWith('.') && !path.isAbsolute(id),
    treeshake: {
      moduleSideEffects: (id: string) => !id.endsWith('.css'),
    },
    output: {
      dir: 'dist',
      format: 'es' as const,
    },
    plugins: [
      ...dts({
        emitDtsOnly: true,
        // The generator follows each package's isolatedDeclarations opt-in.
        incremental: false,
      }),
      copyDeclarationsForCommonJs(),
    ],
  })));
}
