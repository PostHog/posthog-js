import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Browser, Page } from 'puppeteer';
import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';
import { launchPuppeteer } from '../utils';

const selectHTML = (grouped: boolean) =>
  `<select id="privacy">${grouped ? '<optgroup label="Privacy">' : ''}<option value="public">Public</option><option value="*******">Stars</option><option value="private">Private</option>${grouped ? '</optgroup>' : ''}</select>`;

describe('select recording and replay', () => {
  let browser: Browser;
  let page: Page;
  const code = readFileSync(
    resolve(__dirname, '../../dist/rrweb.umd.cjs'),
    'utf8',
  );

  beforeAll(async () => {
    browser = await launchPuppeteer();
  });
  beforeEach(async () => {
    page = await browser.newPage();
    await page.setContent('<!DOCTYPE html><main id="fixture"></main>');
    await page.evaluate(code);
  });
  afterEach(async () => {
    await page.close();
  });
  afterAll(async () => {
    await browser.close();
  });

  it.each([
    { grouped: false, masked: false },
    { grouped: true, masked: false },
    { grouped: false, masked: true },
    { grouped: true, masked: true },
  ])('records option.selected changes: %j', async ({ grouped, masked }) => {
    const html = selectHTML(grouped);
    const result = await page.evaluate(
      async ({ html, masked }) => {
        const { record, Replayer } = (
          window as unknown as { rrweb: typeof import('../../src') }
        ).rrweb;
        document.querySelector('#fixture')!.innerHTML = html;
        const select = document.querySelector('select')!;
        const events: eventWithTime[] = [];
        const stop = record({
          maskAllInputs: masked,
          emit: (event) => events.push(event),
        })!;
        await new Promise((resolve) => setTimeout(resolve, 20));
        select.options[2].selected = true;
        await new Promise((resolve) => setTimeout(resolve, 0));
        const id = record.mirror.getId(select);
        record.addCustomEvent('end', null);
        stop();
        const replayer = new Replayer(events);
        replayer.pause(
          events[events.length - 1].timestamp - events[0].timestamp + 1,
        );
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        const replayed =
          replayer.iframe.contentDocument!.querySelector('select')!;
        const result = {
          events,
          id,
          value: select.value,
          replayed: replayed.value,
        };
        replayer.destroy();
        return result;
      },
      { html, masked },
    );
    const inputs = result.events.filter(
      (event) =>
        event.type === EventType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Input,
    );
    expect(result.value).toBe('private');
    expect(result.id).toBeGreaterThan(0);
    expect(result.replayed).toBe(masked ? '' : 'private');
    expect(inputs.map((event) => event.data)).toEqual([
      {
        source: IncrementalSource.Input,
        id: result.id,
        text: masked ? '*******' : 'private',
        isChecked: false,
      },
    ]);
  });

  it.each(['rr-ignore', 'rr-block'])(
    'does not record option.selected changes on a %s select',
    async (className) => {
      const html = selectHTML(true);
      const events = await page.evaluate(
        async ({ html, className }) => {
          const { record } = (
            window as unknown as { rrweb: typeof import('../../src') }
          ).rrweb;
          document.querySelector('#fixture')!.innerHTML = html;
          const select = document.querySelector('select')!;
          select.className = className;
          const events: eventWithTime[] = [];
          const stop = record({ emit: (event) => events.push(event) })!;
          select.options[2].selected = true;
          await new Promise((resolve) => setTimeout(resolve, 0));
          stop();
          return events;
        },
        { html, className },
      );
      expect(
        events.some(
          (event) =>
            event.type === EventType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.Input,
        ),
      ).toBe(false);
    },
  );

  for (const added of [false, true]) {
    it.each(['play', 'seek', 'seek without virtual DOM'])(
      `preserves an unmasked asterisk value after options change (${added ? 'mutation' : 'snapshot'}, %s)`,
      async (mode) => {
        const result = await page.evaluate(
          async ({ added, mode }) => {
            const { record, Replayer } = (
              window as unknown as { rrweb: typeof import('../../src') }
            ).rrweb;
            const fixture = document.querySelector('#fixture')!;
            const mount = () => {
              fixture.innerHTML =
                '<select id="privacy"><option value="*">All</option>' +
                '<option value="private">Private</option></select>';
            };
            if (!added) mount();
            const events: eventWithTime[] = [];
            const stop = record({
              maskAllInputs: false,
              emit: (event) => events.push(event),
            })!;
            await new Promise((resolve) => setTimeout(resolve, 20));
            if (added) {
              mount();
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
            const select = fixture.querySelector('select')!;
            select.options[0].remove();
            select.add(new Option('Public', 'public'));
            await new Promise((resolve) => setTimeout(resolve, 20));
            record.addCustomEvent('end', null);
            stop();
            const replayer = new Replayer(events, {
              useVirtualDom: mode !== 'seek without virtual DOM',
            });
            if (mode === 'play') {
              await new Promise<void>((resolve) => {
                replayer.on('finish', () => resolve());
                replayer.play();
              });
            } else {
              replayer.pause(
                events[events.length - 1].timestamp - events[0].timestamp + 1,
              );
            }
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
            const replayed = replayer.iframe.contentDocument!.querySelector(
              '#privacy',
            ) as HTMLSelectElement;
            const result = {
              live: select.value,
              replayed: replayed.value,
              selectedIndex: replayed.selectedIndex,
            };
            replayer.destroy();
            return result;
          },
          { added, mode },
        );
        expect(result.live).toBe('private');
        expect(result.replayed).toBe('private');
        expect(result.selectedIndex).toBe(0);
      },
    );
  }

  for (const added of [false, true]) {
    for (const masked of [false, true]) {
      it.each(['play', 'seek', 'seek without virtual DOM'])(
        `replays a ${masked ? 'masked' : 'visible'} select ${added ? 'added by a mutation' : 'in the full snapshot'} (%s)`,
        async (mode) => {
          const html = selectHTML(true);
          const result = await page.evaluate(
            async ({ html, added, masked, mode }) => {
              const { record, Replayer } = (
                window as unknown as { rrweb: typeof import('../../src') }
              ).rrweb;
              const fixture = document.querySelector('#fixture')!;
              const mount = () => {
                fixture.innerHTML = html;
                fixture.querySelector('select')!.options[2].selected = true;
              };
              if (!added) mount();
              const events: eventWithTime[] = [];
              const stop = record({
                maskAllInputs: masked,
                emit: (event) => events.push(event),
              })!;
              await new Promise((resolve) => setTimeout(resolve, 20));
              if (added) mount();
              await new Promise((resolve) => setTimeout(resolve, 20));
              record.addCustomEvent('end', null);
              stop();
              const replayer = new Replayer(events, {
                useVirtualDom: mode !== 'seek without virtual DOM',
              });
              if (mode === 'play') {
                await new Promise<void>((resolve) => {
                  replayer.on('finish', () => resolve());
                  replayer.play();
                });
              } else {
                replayer.pause(
                  events[events.length - 1].timestamp - events[0].timestamp,
                );
              }
              await new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              );
              const select = replayer.iframe.contentDocument!.querySelector(
                '#privacy',
              ) as HTMLSelectElement;
              const result = {
                value: select.value,
                selectedIndex: select.selectedIndex,
                selectedAttributes: Array.from(select.options, (option) =>
                  option.hasAttribute('selected'),
                ),
              };
              replayer.destroy();
              return result;
            },
            { html, added, masked, mode },
          );
          expect(result.selectedIndex).toBe(masked ? -1 : 2);
          expect(result.value).toBe(masked ? '' : 'private');
          expect(result.selectedAttributes).toEqual(
            masked ? [false, false, false] : [false, false, true],
          );
        },
      );
    }
  }
});
