import * as fs from 'fs';
import * as path from 'path';
import type * as puppeteer from 'puppeteer';
import type { Server } from 'http';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { getServerURL, launchPuppeteer, startServer } from '../utils';
import type { eventWithTime } from '@posthog/rrweb-types';
import type record from '../../src/record';
import type { Replayer } from '../../src/replay';

describe('CSS variable shorthand sources', () => {
  let browser: puppeteer.Browser;
  let page: puppeteer.Page;
  let server: Server;
  let bundle: string;

  beforeAll(async () => {
    browser = await launchPuppeteer();
    server = await startServer();
    bundle = fs.readFileSync(
      path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
      'utf8',
    );
  });
  beforeEach(async () => {
    page = await browser.newPage();
    await page.goto(getServerURL(server) + '/html/blank.html');
    await page.setContent(
      '<!doctype html><html><head></head><body><div id="card">Padding fixture</div></body></html>',
    );
    await page.evaluate(bundle);
  });
  afterEach(async () => {
    await page?.close();
  });
  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  it.each([
    'replaceSync',
    'replace',
    'insertRule',
    'group',
    'nested-insertRule',
    'style',
    'shadow',
    'variable-update',
  ] as const)(
    'preserves %s source through first adoption and a full snapshot',
    async (method) => {
      const result = await page.evaluate(async (method) => {
        const api = (
          window as unknown as {
            rrweb: { record: typeof record; Replayer: typeof Replayer };
          }
        ).rrweb;
        const events: eventWithTime[] = [];
        const stop = api.record({ emit: (event) => events.push(event) });
        const wait = () => new Promise((resolve) => setTimeout(resolve, 30));
        let host: Document | ShadowRoot = document;
        if (method === 'shadow') {
          const element = document.createElement('div');
          element.id = 'shadow-host';
          document.body.append(element);
          host = element.attachShadow({ mode: 'open' });
          host.append(document.querySelector('#card')!);
          await wait();
        }
        let sheet: CSSStyleSheet;
        if (method === 'style') {
          const style = document.createElement('style');
          document.head.append(style);
          sheet = style.sheet!;
          await wait();
        } else sheet = new CSSStyleSheet();
        const declarations = ':root, :host { --p: 8px; }';
        const rule = '#card { padding: var(--p); padding-left: 12px; }';
        if (method === 'replace') await sheet.replace(declarations + rule);
        else if (
          method === 'replaceSync' ||
          method === 'shadow' ||
          method === 'variable-update'
        )
          sheet.replaceSync(declarations + rule);
        else if (method === 'group')
          sheet.replaceSync(
            declarations + '@media (min-width: 0px) {' + rule + '}',
          );
        else if (method === 'nested-insertRule') {
          sheet.insertRule(declarations, 0);
          sheet.insertRule('@media all {}', 1);
          (sheet.cssRules[1] as CSSMediaRule).insertRule(rule, 0);
        } else {
          sheet.insertRule(declarations, 0);
          sheet.insertRule(rule, 1);
        }
        if (method !== 'style') host.adoptedStyleSheets = [sheet];
        await wait();
        const initial = events.slice();
        if (method === 'variable-update') {
          document.documentElement.style.setProperty('--p', '16px');
        }
        api.record.takeFullSnapshot();
        await wait();
        stop?.();
        const live = getComputedStyle(host.querySelector('#card')!).paddingTop;
        const rendered: string[] = [];
        for (const recording of [initial, events]) {
          const root = document.createElement('div');
          document.body.append(root);
          const replayer = new api.Replayer(recording, {
            root,
            mouseTail: false,
          });
          replayer.pause(
            recording[recording.length - 1].timestamp -
              recording[0].timestamp +
              100,
          );
          await wait();
          const replayDoc = replayer.iframe.contentDocument!;
          const replayHost =
            method === 'shadow'
              ? replayDoc.querySelector('#shadow-host')!.shadowRoot!
              : replayDoc;
          rendered.push(
            replayDoc.defaultView!.getComputedStyle(
              replayHost.querySelector('#card')!,
            ).paddingTop,
          );
          replayer.destroy();
          root.remove();
        }
        return { live, rendered };
      }, method);
      expect(result).toEqual({
        live: method === 'variable-update' ? '16px' : '8px',
        rendered: ['8px', method === 'variable-update' ? '16px' : '8px'],
      });
    },
  );

  it.each(['replaceSync', 'insertRule'] as const)(
    'does not let an older async replacement overwrite a newer %s source',
    async (method) => {
      const result = await page.evaluate(async (method) => {
        const api = (
          window as unknown as {
            rrweb: { record: typeof record; Replayer: typeof Replayer };
          }
        ).rrweb;
        const events: eventWithTime[] = [];
        const stop = api.record({ emit: (event) => events.push(event) });
        const sheet = new CSSStyleSheet();
        document.adoptedStyleSheets = [sheet];
        const declarations = ':root { --p: 8px; --q: 16px; }';
        const pending = sheet.replace(
          declarations + '#card { padding: var(--p); padding-left: 12px; }',
        );
        if (method === 'replaceSync') {
          sheet.replaceSync(
            declarations + '#card { padding: var(--q); padding-left: 12px; }',
          );
        } else {
          sheet.deleteRule(1);
          sheet.insertRule(
            '#card { padding: var(--q); padding-left: 12px; }',
            1,
          );
        }
        await pending;
        api.record.takeFullSnapshot();
        await new Promise((resolve) => setTimeout(resolve, 30));
        stop?.();
        const root = document.createElement('div');
        document.body.append(root);
        const replayer = new api.Replayer(events, { root, mouseTail: false });
        replayer.pause(
          events[events.length - 1].timestamp - events[0].timestamp + 100,
        );
        await new Promise((resolve) => setTimeout(resolve, 30));
        const doc = replayer.iframe.contentDocument!;
        const result = {
          live: getComputedStyle(document.querySelector('#card')!).paddingTop,
          replay: doc.defaultView!.getComputedStyle(doc.querySelector('#card')!)
            .paddingTop,
        };
        replayer.destroy();
        root.remove();
        return result;
      }, method);
      expect(result).toEqual({ live: '16px', replay: '16px' });
    },
  );

  it.each(['setProperty', 'padding', 'cssText', 'styleMap'] as const)(
    'does not reuse stale source after a %s assignment with identical cssText',
    async (method) => {
      const result = await page.evaluate(async (method) => {
        const api = (window as unknown as { rrweb: { record: typeof record } })
          .rrweb;
        const originalGetter = Object.getOwnPropertyDescriptor(
          CSSStyleRule.prototype,
          method === 'styleMap' ? 'styleMap' : 'style',
        )?.get;
        const events: eventWithTime[] = [];
        const stop = api.record({ emit: (event) => events.push(event) });
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(
          ':root { --p: 8px; --q: 16px; } #card { padding: var(--p); padding-left: 12px; }',
        );
        document.adoptedStyleSheets = [sheet];
        const rule = sheet.cssRules[1] as CSSStyleRule;
        const before = rule.cssText;
        let sameObject: boolean;
        let nativeMethods: boolean;
        if (method === 'styleMap') {
          const map = rule.styleMap;
          sameObject = map === rule.styleMap;
          nativeMethods = map.set === StylePropertyMap.prototype.set;
          map.set('padding', 'var(--q)');
          map.set('padding-left', '12px');
        } else {
          const style = rule.style;
          sameObject = style === rule.style;
          nativeMethods =
            style.setProperty === CSSStyleDeclaration.prototype.setProperty;
          if (method === 'setProperty') {
            style.setProperty('padding', 'var(--q)');
            style.setProperty('padding-left', '12px');
          } else if (method === 'padding') {
            style.padding = 'var(--q)';
            style.paddingLeft = '12px';
          } else style.cssText = 'padding: var(--q); padding-left: 12px;';
        }
        const checkpoint = events.length;
        api.record.takeFullSnapshot();
        await new Promise((resolve) => setTimeout(resolve, 30));
        stop?.();
        return {
          sameObject,
          nativeMethods,
          sameCssText: rule.cssText === before,
          live: getComputedStyle(document.querySelector('#card')!).paddingTop,
          staleSource: JSON.stringify(events.slice(checkpoint)).includes(
            'padding: var(--p)',
          ),
          restoredGetter:
            Object.getOwnPropertyDescriptor(
              CSSStyleRule.prototype,
              method === 'styleMap' ? 'styleMap' : 'style',
            )?.get === originalGetter,
        };
      }, method);
      expect(result).toEqual({
        sameObject: true,
        nativeMethods: true,
        sameCssText: true,
        live: '16px',
        staleSource: false,
        restoredGetter: true,
      });
    },
  );

  it.each(['appendRule', 'deleteRule'] as const)(
    'does not reuse stale keyframes after an intercepted %s',
    async (method) => {
      const result = await page.evaluate(async (method) => {
        const api = (window as unknown as { rrweb: { record: typeof record } })
          .rrweb;
        const originalAppend = CSSKeyframesRule.prototype.appendRule;
        const originalDelete = CSSKeyframesRule.prototype.deleteRule;
        const events: eventWithTime[] = [];
        const stop = api.record({ emit: (event) => events.push(event) });
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(
          ':root { --p: 8px; --q: 16px; }' +
            '#card { animation: padding-test 1s -1s both paused; }' +
            '@keyframes padding-test { 100% { padding: var(--p); padding-left: 12px; } }',
        );
        document.adoptedStyleSheets = [sheet];
        const frames = sheet.cssRules[2] as CSSKeyframesRule;
        const before = frames.cssText;
        // Bypass the other hook to verify each mutation method independently.
        if (method === 'appendRule') originalDelete.call(frames, '100%');
        else frames.deleteRule('100%');
        const replacement = '100% { padding: var(--q); padding-left: 12px; }';
        if (method === 'deleteRule') originalAppend.call(frames, replacement);
        else frames.appendRule(replacement);
        const checkpoint = events.length;
        api.record.takeFullSnapshot();
        await new Promise((resolve) => setTimeout(resolve, 30));
        stop?.();
        return {
          sameCssText: frames.cssText === before,
          live: getComputedStyle(document.querySelector('#card')!).paddingTop,
          staleSource: JSON.stringify(events.slice(checkpoint)).includes(
            'padding: var(--p)',
          ),
          restoredAppend:
            CSSKeyframesRule.prototype.appendRule === originalAppend,
          restoredDelete:
            CSSKeyframesRule.prototype.deleteRule === originalDelete,
        };
      }, method);
      expect(result).toEqual({
        sameCssText: true,
        live: '16px',
        staleSource: false,
        restoredAppend: true,
        restoredDelete: true,
      });
    },
  );

  it('does not overwrite a later keyframe method wrapper on stop', async () => {
    const preserved = await page.evaluate(() => {
      const api = (window as unknown as { rrweb: { record: typeof record } })
        .rrweb;
      const original = CSSKeyframesRule.prototype.appendRule;
      const stop = api.record({ emit: () => {} });
      const observed = CSSKeyframesRule.prototype.appendRule;
      const later = function (this: CSSKeyframesRule, text: string) {
        return observed.call(this, text);
      };
      CSSKeyframesRule.prototype.appendRule = later;
      stop?.();
      const preserved = CSSKeyframesRule.prototype.appendRule === later;
      CSSKeyframesRule.prototype.appendRule = original;
      return preserved;
    });
    expect(preserved).toBe(true);
  });

  it('replays rules wrapped in stylesheet-only comment tokens', async () => {
    const result = await page.evaluate(async () => {
      const api = (
        window as unknown as {
          rrweb: { record: typeof record; Replayer: typeof Replayer };
        }
      ).rrweb;
      document.documentElement.style.setProperty('--p', '8px');
      const events: eventWithTime[] = [];
      const stop = api.record({ emit: (event) => events.push(event) });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(
        '<!-- #card { padding: var(--p); padding-left: 12px; background: rgb(1, 2, 3); } -->',
      );
      document.adoptedStyleSheets = [sheet];
      api.record.takeFullSnapshot();
      await new Promise((resolve) => setTimeout(resolve, 30));
      stop?.();
      const root = document.createElement('div');
      document.body.append(root);
      const replayer = new api.Replayer(events, { root, mouseTail: false });
      replayer.pause(
        events[events.length - 1].timestamp - events[0].timestamp + 100,
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      const doc = replayer.iframe.contentDocument!;
      const live = getComputedStyle(document.querySelector('#card')!);
      const replay = doc.defaultView!.getComputedStyle(
        doc.querySelector('#card')!,
      );
      const result = {
        live: { padding: live.paddingTop, background: live.backgroundColor },
        replay: {
          padding: replay.paddingTop,
          background: replay.backgroundColor,
        },
      };
      replayer.destroy();
      root.remove();
      return result;
    });
    expect(result).toEqual({
      live: { padding: '8px', background: 'rgb(1, 2, 3)' },
      replay: { padding: '8px', background: 'rgb(1, 2, 3)' },
    });
  });

  it.each(['initial', 'late', 'changed'] as const)(
    'keeps a %s link when inlining its CSS would lose variable shorthand values',
    async (mode) => {
      const context = await page.evaluateHandle((mode) => {
        const api = (
          window as unknown as {
            rrweb: { record: typeof record; Replayer: typeof Replayer };
          }
        ).rrweb;
        const events: eventWithTime[] = [];
        let stop: (() => void) | undefined;
        if (mode === 'late')
          stop = api.record({ emit: (event) => events.push(event) });
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href =
          mode === 'changed'
            ? '/html/css-variable-padding-initial.css'
            : '/html/css-variable-padding.css';
        document.head.append(link);
        return { api, events, stop, link };
      }, mode);
      const waitForStylesheet = () =>
        page.waitForFunction(
          ({ link }) => link.sheet?.href === link.href,
          {},
          context,
        );
      await waitForStylesheet();
      await page.evaluate(
        (context, mode) => {
          if (mode !== 'late')
            context.stop = context.api.record({
              emit: (event) => context.events.push(event),
            });
          if (mode === 'changed') {
            // Chrome 131 omits this event on href changes; exercise that path in newer browsers too.
            context.link.addEventListener(
              'load',
              (event) => event.stopImmediatePropagation(),
              { capture: true },
            );
            context.link.href = '/html/css-variable-padding.css';
          }
        },
        context,
        mode,
      );
      if (mode === 'changed') await waitForStylesheet();
      const result = await page.evaluate(async ({ api, events, stop }) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        stop?.();
        const root = document.createElement('div');
        document.body.append(root);
        const replayer = new api.Replayer(events, { root, mouseTail: false });
        replayer.pause(
          events[events.length - 1].timestamp - events[0].timestamp + 100,
        );
        await new Promise((resolve) => setTimeout(resolve, 250));
        const doc = replayer.iframe.contentDocument!;
        const result = {
          live: getComputedStyle(document.querySelector('#card')!).paddingTop,
          replay: doc.defaultView!.getComputedStyle(doc.querySelector('#card')!)
            .paddingTop,
          keptLink: !!doc.querySelector('link[rel="stylesheet"]'),
        };
        replayer.destroy();
        root.remove();
        return result;
      }, context);
      await context.dispose();
      expect(result).toEqual({ live: '8px', replay: '8px', keptLink: true });
    },
  );
});
