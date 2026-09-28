import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const dist = resolve(__dirname, '../dist');
const vite6Baseline = { rawBytes: 556_842, gzipBytes: 122_207 };

function javascriptArtifacts() {
  return readdirSync(dist)
    .filter((artifact) => /\.(?:js|cjs)$/.test(artifact))
    .map((artifact) => readFileSync(resolve(dist, artifact)));
}

describe('build output', () => {
  for (const format of ['import', 'require']) {
    for (const performanceMode of [
      'native-performance',
      'without-performance',
    ]) {
      it(`supports native ${format} with selectors and ${performanceMode}`, () => {
        const entry = resolve(
          dist,
          format === 'import' ? 'rrdom-nodejs.js' : 'rrdom-nodejs.umd.cjs',
        );
        const output = execFileSync(
          process.execPath,
          [
            resolve(__dirname, 'fixtures/native-consumer.mjs'),
            format,
            format === 'import' ? pathToFileURL(entry).href : entry,
            performanceMode,
          ],
          { encoding: 'utf8' },
        );
        expect(output).toContain('selectors, styles and polyfills passed');
      });
    }
  }

  it('stays within the Vite 6 size baseline', () => {
    const artifacts = javascriptArtifacts();
    const rawBytes = artifacts.reduce(
      (total, artifact) => total + artifact.byteLength,
      0,
    );
    const gzipBytes = artifacts.reduce(
      (total, artifact) => total + gzipSync(artifact).byteLength,
      0,
    );

    expect(rawBytes).toBeLessThanOrEqual(
      Math.ceil(vite6Baseline.rawBytes * 1.05),
    );
    expect(gzipBytes).toBeLessThanOrEqual(
      Math.ceil(vite6Baseline.gzipBytes * 1.05),
    );
  });

  it('keeps runtime dependencies external', () => {
    const cjs = readFileSync(resolve(dist, 'rrdom-nodejs.cjs'), 'utf8');

    ['cssom', 'cssstyle', 'nwsapi', 'perf_hooks'].forEach((dependency) => {
      expect(cjs).toContain(`require("${dependency}")`);
    });
  });
});
