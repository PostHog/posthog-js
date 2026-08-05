/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StylesheetManager } from '../../src/record/stylesheet-manager';
import type { mutationCallBack } from '@posthog/rrweb-types';

describe('StylesheetManager.inlineDeferredLinkElement()', () => {
  const LINK_ID = 7;
  const CSS = '.owner::after {content: "alice@example.com";}';
  let mutationCb: ReturnType<typeof vi.fn>;
  let linkEl: HTMLLinkElement;
  let styleEl: HTMLStyleElement;

  const emittedCssText = () =>
    mutationCb.mock.calls[0][0].attributes[0].attributes._cssText as string;

  const makeManager = (
    options: Partial<ConstructorParameters<typeof StylesheetManager>[0]> = {},
  ) =>
    new StylesheetManager({
      mutationCb: mutationCb as unknown as mutationCallBack,
      adoptedStyleSheetCb: vi.fn(),
      ...options,
    });

  beforeEach(() => {
    mutationCb = vi.fn();
    // jsdom does not load stylesheets for <link>, so borrow a real sheet
    // from a <style> element and expose it on the link.
    styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);
    linkEl = document.createElement('link');
    document.head.appendChild(linkEl);
    Object.defineProperty(linkEl, 'sheet', { value: styleEl.sheet });
  });

  afterEach(() => {
    styleEl.remove();
    linkEl.remove();
  });

  it('emits the raw stylesheet when no masking is configured', () => {
    makeManager().inlineDeferredLinkElement(linkEl, LINK_ID);

    expect(emittedCssText()).toContain('alice@example.com');
  });

  it('masks the emitted _cssText under maskAllElementAttributes', () => {
    makeManager({ maskAllElementAttributes: true }).inlineDeferredLinkElement(
      linkEl,
      LINK_ID,
    );

    expect(emittedCssText()).toMatch(/^\*+$/);
  });

  it('routes the emitted _cssText through maskAttributeFn', () => {
    const maskAttributeFn = vi.fn(() => '[CSS-MASKED]');

    makeManager({ maskAttributeFn }).inlineDeferredLinkElement(
      linkEl,
      LINK_ID,
    );

    expect(emittedCssText()).toBe('[CSS-MASKED]');
    expect(maskAttributeFn).toHaveBeenCalledWith(
      '_cssText',
      expect.stringContaining('alice@example.com'),
      linkEl,
    );
  });

  it('ignores maskAttributeFn when maskAllElementAttributes is set', () => {
    const maskAttributeFn = vi.fn(() => '[CSS-MASKED]');

    makeManager({
      maskAllElementAttributes: true,
      maskAttributeFn,
    }).inlineDeferredLinkElement(linkEl, LINK_ID);

    expect(emittedCssText()).toMatch(/^\*+$/);
    expect(maskAttributeFn).not.toHaveBeenCalled();
  });
});
