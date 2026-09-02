import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

export function ensureSourcemap(outputDir: string, fileName: string) {
  const outputPath = resolve(outputDir, fileName);
  const mapPath = `${outputPath}.map`;
  const basename = fileName.split('/').pop()!;
  const sourcemapComment = `//# sourceMappingURL=${basename}.map`;
  const hasCurrentSourcemapComment = readFileSync(outputPath, 'utf8')
    .trimEnd()
    .endsWith(sourcemapComment);

  if (!hasCurrentSourcemapComment) {
    appendFileSync(outputPath, `\n${sourcemapComment}\n`);
  }

  if (hasCurrentSourcemapComment && existsSync(mapPath)) {
    return;
  }

  writeFileSync(
    mapPath,
    JSON.stringify({
      version: 3,
      file: basename,
      sources: [],
      sourcesContent: [],
      names: [],
      mappings: '',
    }),
  );
}
