import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression test for the privacy concern raised by @marandaneto on
 * PR #5244:
 *
 *   > Do not log a raw masked node into replay console capture — with
 *   > console recording enabled, passing `n` here serializes its raw
 *   > `outerHTML` without DOM masking.
 *
 * The rrweb console-record plugin stringifies any `Node` argument via
 * its `outerHTML`
 * (see `rrweb-plugin-console-record/src/stringify.ts`, the
 * `instanceof Node` branch returns `value.outerHTML`).
 *
 * The fix in commit <this PR> replaces the second argument to the
 * `Couldn't record new node` warning in
 * `packages/rrweb/rrweb/src/record/mutation.ts` with a sanitized
 * descriptor string, so no `outerHTML` can leak to a
 * `rrweb/console@1` event even when console recording is enabled.
 *
 * The assertions below are grep-level and run without a browser so
 * they stay cheap. The absence of `, n,` in the fix region is the
 * invariant the reviewer asked for.
 */

const MUTATION_TS = path.resolve(
  __dirname,
  '../../src/record/mutation.ts',
);

describe('PR #5244 — privacy regression on diagnostic warn', () => {
  const src = fs.readFileSync(MUTATION_TS, 'utf8');

  it("does not pass the raw node 'n' as the warn argument", () => {
    // The pre-fix shape was:
    //   console.warn(
    //     "Couldn't record new node. ...",
    //     n,
    //   );
    // Any line that still contains the literal `, n,` or `, n)`
    // after the warning text would leak the node again.
    const warnBlock = extractWarnBlock(src);
    expect(warnBlock).toMatch(/console\.warn/);
    expect(warnBlock).not.toMatch(/,\s*n\s*,/);
    expect(warnBlock).not.toMatch(/,\s*n\s*\)/);
  });

  it('passes a sanitized descriptor instead', () => {
    const warnBlock = extractWarnBlock(src);
    // The fix constructs a `descriptor` string that only exposes
    // the tag name and nodeType — never the outerHTML.
    expect(warnBlock).toMatch(/descriptor/);
    expect(warnBlock).toMatch(/tagName|nodeType/);
  });

  it('still references the privacy guard rationale in a comment', () => {
    const warnBlock = extractWarnBlock(src);
    // The code comment must survive refactors so future readers do
    // not re-introduce the raw-node argument.
    expect(warnBlock).toMatch(/console-record|outerHTML|privacy/i);
  });
});

function extractWarnBlock(src: string): string {
  // Grab the window of code around the first "Couldn't record new node"
  // warning. 500 chars is enough to cover the warn call + the comment
  // block that documents why the descriptor is used.
  const marker = "Couldn't record new node";
  const idx = src.indexOf(marker);
  if (idx === -1) {
    throw new Error(
      `could not locate the diagnostic warn in ${MUTATION_TS}`,
    );
  }
  const start = Math.max(0, idx - 500);
  const end = Math.min(src.length, idx + 500);
  return src.slice(start, end);
}
