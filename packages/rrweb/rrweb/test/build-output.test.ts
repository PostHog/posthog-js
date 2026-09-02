import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const dist = resolve(__dirname, '../dist');
const require = createRequire(import.meta.url);
const javascriptArtifacts = [
  'rrweb.js',
  'rrweb.cjs',
  'rrweb.umd.cjs',
  'rrweb.umd.min.cjs',
];

describe('build output', () => {
  it('does not include a source map URL in the inline canvas worker', () => {
    const bundle = readFileSync(resolve(dist, 'rrweb.js'), 'utf8');

    expect(bundle).not.toContain(
      'sourceMappingURL=image-bitmap-data-url-worker-',
    );
    expect(bundle).toContain('sourceMappingURL=rrweb.js.map');
  });

  it('emits loadable ESM, CJS, UMD, and minified UMD entrypoints', async () => {
    const esm = await import(pathToFileURL(resolve(dist, 'rrweb.js')).href);
    const cjs = require(resolve(dist, 'rrweb.cjs'));
    const umd = require(resolve(dist, 'rrweb.umd.cjs'));
    const minifiedUmd = require(resolve(dist, 'rrweb.umd.min.cjs'));
    const exportNames = Object.keys(esm).sort();

    expect(Object.keys(cjs).sort()).toEqual(exportNames);
    expect(Object.keys(umd).sort()).toEqual(exportNames);
    expect(Object.keys(minifiedUmd).sort()).toEqual(exportNames);
  });

  it('emits valid source maps referenced by every JavaScript artifact', () => {
    javascriptArtifacts.forEach((artifact) => {
      const artifactPath = resolve(dist, artifact);
      const source = readFileSync(artifactPath, 'utf8');
      const map = JSON.parse(readFileSync(`${artifactPath}.map`, 'utf8'));

      expect(source.trimEnd()).toMatch(
        new RegExp(`sourceMappingURL=${artifact.replaceAll('.', '\\.')}.map$`),
      );
      expect(map).toMatchObject({ version: 3 });
      expect([undefined, artifact]).toContain(map.file);
    });
  });

  it('emits declaration, CSS, and bundle-analysis artifacts', () => {
    expect(readFileSync(resolve(dist, 'rrweb.d.cts'))).toEqual(
      readFileSync(resolve(dist, 'rrweb.d.ts')),
    );
    ['style.css', 'style.min.css', 'style.min.css.map'].forEach((artifact) => {
      expect(existsSync(resolve(dist, artifact))).toBe(true);
    });
    expect(existsSync(resolve(__dirname, '../../rrweb-bundle-analysis.html'))).toBe(
      true,
    );
  });
});
