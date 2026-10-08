/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { _mirror } from '../src/utils';

describe('deprecated mirror diagnostics', () => {
  afterEach(() => vi.restoreAllMocks());

  it('warns without turning deprecated API access into console errors', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(_mirror.map).toEqual({});
    expect(_mirror.getId(document.body)).toBe(-1);
    expect(_mirror.getNode(1)).toBeNull();
    _mirror.removeNodeFromMap(document.body);
    expect(_mirror.has(1)).toBe(false);
    _mirror.reset();

    expect(warn).toHaveBeenCalledTimes(6);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Please stop import mirror directly.'),
    );
    expect(error).not.toHaveBeenCalled();
  });
});
