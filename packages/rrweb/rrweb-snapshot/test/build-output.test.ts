import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const dist = resolve(__dirname, '../dist');
const vite6Baseline = { rawBytes: 1_282_071, gzipBytes: 311_326 };

describe('build output', () => {
  it('stays within the Vite 6 size baseline', () => {
    const artifacts = readdirSync(dist)
      .filter((artifact) => /\.(?:js|cjs)$/.test(artifact))
      .map((artifact) => readFileSync(resolve(dist, artifact)));
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

  it.each(['esm', 'cjs'])(
    'keeps select capture helpers on recording entrypoints (%s)',
    async (format) => {
      const load = (entry: string) =>
        format === 'esm'
          ? import(resolve(dist, `${entry}.js`))
          : createRequire(import.meta.url)(resolve(dist, `${entry}.cjs`));
      const [full, record, replay] = await Promise.all([
        load('rrweb-snapshot'),
        load('record'),
        load('replay'),
      ]);
      for (const entry of [full, record]) {
        expect(entry).toHaveProperty(
          'getInputMaskOptions',
          expect.any(Function),
        );
        expect(entry).toHaveProperty(
          'isMaskedSelectedContent',
          expect.any(Function),
        );
      }
      expect(replay).not.toHaveProperty('getInputMaskOptions');
      expect(replay).not.toHaveProperty('isMaskedSelectedContent');
      expect(replay).toHaveProperty('rebuild', expect.any(Function));
      expect(replay).toHaveProperty(
        'updateSelectMaskingState',
        expect.any(Function),
      );
    },
  );

  it('only emits UMD variants for public entrypoints', () => {
    const umdArtifacts = readdirSync(dist)
      .filter((artifact) => /\.umd(?:\.min)?\.cjs$/.test(artifact))
      .sort();

    expect(umdArtifacts).toEqual([
      'record.umd.cjs',
      'record.umd.min.cjs',
      'replay.umd.cjs',
      'replay.umd.min.cjs',
      'rrweb-snapshot.umd.cjs',
      'rrweb-snapshot.umd.min.cjs',
    ]);
  });
});
