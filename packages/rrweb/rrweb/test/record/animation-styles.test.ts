import * as path from 'path';
import { vi } from 'vitest';
import type * as puppeteer from 'puppeteer';

import { launchPuppeteer, waitForRAF } from '../utils';
import { EventType, IncrementalSource, NodeType } from '@posthog/rrweb-types';
import type {
  eventWithTime,
  listenerHandler,
  mutationData,
  serializedNodeWithId,
} from '@posthog/rrweb-types';
import type { recordOptions } from '../../src/types';

interface IWindow extends Window {
  rrweb: {
    record: (
      options: recordOptions<eventWithTime>,
    ) => listenerHandler | undefined;
  };
  emit: (e: eventWithTime) => undefined;
}

// base CSS keeps `.held` in its pre-animation state, the way Ionic styles an
// overlay before its enter animation runs
const pageContent = `<!DOCTYPE html><html><head><style>
  .held { width: 100px; height: 100px; opacity: 0.01; transform: translate(0px, 40px); }
</style></head><body></body></html>`;

const KEYFRAMES = [
  { opacity: 0.01, transform: 'translate(0px, 40px)' },
  { opacity: 1, transform: 'translate(0px, 0px)' },
];

/**
 * element id attribute -> mirror id, from the full snapshot and every add;
 * blocked elements lose their id, so they are keyed by class instead
 */
function idsByElementId(events: eventWithTime[]): Record<string, number> {
  const ids: Record<string, number> = {};
  const visit = (n: serializedNodeWithId) => {
    if (n.type === NodeType.Element) {
      const key = n.attributes.id ?? n.attributes.class;
      if (typeof key === 'string') ids[key] = n.id;
    }
    if ('childNodes' in n) n.childNodes.forEach(visit);
  };
  for (const e of events) {
    if (e.type === EventType.FullSnapshot) visit(e.data.node);
    if (
      e.type === EventType.IncrementalSnapshot &&
      e.data.source === IncrementalSource.Mutation
    )
      e.data.adds.forEach((a) => visit(a.node));
  }
  return ids;
}

function fullSnapshotStyles(events: eventWithTime[]): Record<string, unknown> {
  const styles: Record<string, unknown> = {};
  const visit = (n: serializedNodeWithId) => {
    if (n.type === NodeType.Element && typeof n.attributes.id === 'string')
      styles[n.attributes.id] = n.attributes.style;
    if ('childNodes' in n) n.childNodes.forEach(visit);
  };
  const full = events.find((e) => e.type === EventType.FullSnapshot);
  if (full?.type === EventType.FullSnapshot) visit(full.data.node);
  return styles;
}

function styleMutations(events: eventWithTime[], id: number) {
  return events
    .filter(
      (e) =>
        e.type === EventType.IncrementalSnapshot &&
        e.data.source === IncrementalSource.Mutation,
    )
    .flatMap((e) => (e.data as mutationData).attributes)
    .filter((a) => a.id === id && a.attributes.style !== undefined)
    .map((a) => a.attributes.style);
}

describe('record animation styles', () => {
  vi.setConfig({ testTimeout: 30_000 });
  let browser: puppeteer.Browser;
  let page: puppeteer.Page;
  let events: eventWithTime[];

  beforeAll(async () => {
    browser = await launchPuppeteer();
  });

  afterAll(async () => {
    await browser?.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.goto('about:blank');
    await page.setContent(pageContent);
    await page.addScriptTag({
      path: path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
    });
    events = [];
    await page.exposeFunction('emit', (e: eventWithTime) => {
      if (e.type === EventType.DomContentLoaded || e.type === EventType.Load) {
        return;
      }
      events.push(e);
    });
  });

  afterEach(async () => {
    await page.close();
  });

  const startRecording = (options: Partial<recordOptions<eventWithTime>>) =>
    page.evaluate((opts) => {
      const { rrweb, emit } = window as unknown as IWindow;
      rrweb.record({ emit, ...opts });
    }, options);

  it('folds styles held by a finished animation into the full snapshot', async () => {
    await page.evaluate((keyframes) => {
      const light = document.createElement('div');
      light.id = 'light';
      light.className = 'held';
      light.style.color = 'red';
      document.body.appendChild(light);
      light.animate(keyframes, { duration: 1, fill: 'both' }).finish();

      // the same inside a shadow root styled by an adopted stylesheet
      const host = document.createElement('div');
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(
        '#shadowed { opacity: 0.01; transform: translate(0px, 40px); }',
      );
      shadow.adoptedStyleSheets = [sheet];
      const shadowed = document.createElement('div');
      shadowed.id = 'shadowed';
      shadow.appendChild(shadowed);
      shadowed.animate(keyframes, { duration: 1, fill: 'both' }).finish();
    }, KEYFRAMES);
    await startRecording({ recordAnimationStyles: true });
    await waitForRAF(page);

    const styles = fullSnapshotStyles(events);
    // the element's own inline style comes first, then each animated property
    expect(styles.light).toMatch(/^color: red; /);
    for (const id of ['light', 'shadowed']) {
      expect(styles[id]).toContain('opacity: 1;');
      expect(styles[id]).toContain('transform: matrix(1, 0, 0, 1, 0, 0);');
    }
  });

  it('does not fold animation styles unless enabled', async () => {
    await page.evaluate((keyframes) => {
      const light = document.createElement('div');
      light.id = 'light';
      light.className = 'held';
      document.body.appendChild(light);
      light.animate(keyframes, { duration: 1, fill: 'both' }).finish();
    }, KEYFRAMES);
    await startRecording({});
    await waitForRAF(page);

    expect(fullSnapshotStyles(events).light).toBeUndefined();
  });

  it('leaves CSS animations and transitions to the replayed stylesheets', async () => {
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = `
        @keyframes spin { to { transform: rotate(360deg); } }
        #css-animated { animation: spin 10s linear infinite; }
        #transitioned { opacity: 1; transition: opacity 10s linear; }
        #transitioned.faded { opacity: 0; }
      `;
      document.head.appendChild(style);
      const animated = document.createElement('div');
      animated.id = 'css-animated';
      document.body.appendChild(animated);
      const transitioned = document.createElement('div');
      transitioned.id = 'transitioned';
      document.body.appendChild(transitioned);
      // flush styles so the class change starts a transition
      getComputedStyle(transitioned).opacity;
      transitioned.className = 'faded';
    });
    await page.waitForFunction(
      () =>
        document.getElementById('css-animated')!.getAnimations().length > 0 &&
        document.getElementById('transitioned')!.getAnimations().length > 0,
    );
    await startRecording({ recordAnimationStyles: true });
    await waitForRAF(page);

    const styles = fullSnapshotStyles(events);
    expect(styles['css-animated']).toBeUndefined();
    expect(styles.transitioned).toBeUndefined();
  });

  it('records the held end state of an animation that finishes after the element was serialized', async () => {
    await startRecording({ recordAnimationStyles: true });
    // an overlay mounted mid-session whose enter animation starts afterwards
    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.id = 'overlay';
      overlay.className = 'held';
      document.body.appendChild(overlay);
    });
    await waitForRAF(page);
    await page.evaluate(
      (keyframes) =>
        document
          .getElementById('overlay')!
          .animate(keyframes, { duration: 50, fill: 'both' }).finished,
      KEYFRAMES,
    );
    await waitForRAF(page);

    const id = idsByElementId(events).overlay;
    expect(id).toBeDefined();
    expect(styleMutations(events, id)).toEqual([
      { opacity: '1', transform: 'matrix(1, 0, 0, 1, 0, 0)' },
    ]);
  });

  it("falls back to the element's own inline style once an animation stops applying", async () => {
    await startRecording({ recordAnimationStyles: true });
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.id = 'el';
      el.className = 'held';
      el.style.setProperty('opacity', '0.5', 'important');
      document.body.appendChild(el);
    });
    await waitForRAF(page);
    await page.evaluate((keyframes) => {
      const el = document.getElementById('el')!;
      const animation = el.animate(keyframes, {
        duration: 1,
        fill: 'forwards',
      });
      (window as unknown as { animation: Animation }).animation = animation;
      return animation.finished;
    }, KEYFRAMES);
    await waitForRAF(page);
    await page.evaluate(() =>
      (window as unknown as { animation: Animation }).animation.cancel(),
    );
    await waitForRAF(page);

    const id = idsByElementId(events).el;
    expect(styleMutations(events, id)).toEqual([
      // finished: an !important inline value outranks the animation
      { opacity: '0.5', transform: 'matrix(1, 0, 0, 1, 0, 0)' },
      // cancelled: back to the inline style, and nothing for transform
      { opacity: ['0.5', 'important'], transform: false },
    ]);
  });

  it('does not record animations on blocked elements', async () => {
    await startRecording({
      recordAnimationStyles: true,
      blockClass: 'blocked',
    });
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.id = 'el';
      el.className = 'held blocked';
      document.body.appendChild(el);
    });
    await waitForRAF(page);
    await page.evaluate(
      (keyframes) =>
        document
          .getElementById('el')!
          .animate(keyframes, { duration: 1, fill: 'both' }).finished,
      KEYFRAMES,
    );
    await waitForRAF(page);

    const id = idsByElementId(events)['held blocked'];
    expect(id).toBeDefined();
    expect(styleMutations(events, id)).toEqual([]);
  });

  it('masks animated styles when every attribute is masked', async () => {
    await page.evaluate((keyframes) => {
      const before = document.createElement('div');
      before.className = 'held';
      document.body.appendChild(before);
      before.animate(keyframes, { duration: 1, fill: 'both' }).finish();
    }, KEYFRAMES);
    await startRecording({
      recordAnimationStyles: true,
      maskAllElementAttributes: true,
    });
    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.id = 'overlay';
      overlay.className = 'held';
      document.body.appendChild(overlay);
    });
    await waitForRAF(page);
    await page.evaluate(
      (keyframes) =>
        document
          .getElementById('overlay')!
          .animate(keyframes, { duration: 1, fill: 'both' }).finished,
      KEYFRAMES,
    );
    await waitForRAF(page);

    // ids are masked too, so check every recorded style instead
    const snapshotStyles = Object.values(fullSnapshotStyles(events));
    const mutationStyles = events
      .filter(
        (e) =>
          e.type === EventType.IncrementalSnapshot &&
          e.data.source === IncrementalSource.Mutation,
      )
      .flatMap((e) => (e.data as mutationData).attributes)
      .map((a) => a.attributes.style)
      .filter((style) => style !== undefined);
    expect(mutationStyles).toHaveLength(1);
    for (const style of [
      ...snapshotStyles.filter((s) => s !== undefined),
      ...mutationStyles,
    ]) {
      expect(style).toMatch(/^\*+$/);
    }
  });

  it('runs animated styles through maskAttributeFn', async () => {
    await page.evaluate(() => {
      const { rrweb, emit } = window as unknown as IWindow;
      rrweb.record({
        emit,
        recordAnimationStyles: true,
        maskAttributeFn: (name, value) =>
          name === 'style' ? `masked(${value})` : value,
      });
      const overlay = document.createElement('div');
      overlay.id = 'overlay';
      overlay.className = 'held';
      overlay.style.color = 'red';
      document.body.appendChild(overlay);
    });
    await waitForRAF(page);
    await page.evaluate(
      (keyframes) =>
        document
          .getElementById('overlay')!
          .animate(keyframes, { duration: 1, fill: 'both' }).finished,
      KEYFRAMES,
    );
    await waitForRAF(page);

    const id = idsByElementId(events).overlay;
    expect(styleMutations(events, id)).toEqual([
      expect.stringMatching(/^masked\(color: red; .*opacity: 1;.*\)$/),
    ]);
  });
});
