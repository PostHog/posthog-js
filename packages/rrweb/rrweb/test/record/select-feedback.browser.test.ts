import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Browser, Page } from 'puppeteer';
import type { eventWithTime, inputData } from '@posthog/rrweb-types';
import { launchPuppeteer } from '../utils';

type TestWindow = Window & {
  rrweb: typeof import('../../src');
  events: eventWithTime[];
  stop: () => void;
};
type ReplayMode = 'play' | 'seek' | 'seek-real';

async function finishReplay(
  page: Page,
  mode: ReplayMode,
  watchRestores = false,
) {
  return page.evaluate(
    async ({ mode, watchRestores }) => {
      const win = window as unknown as TestWindow;
      await new Promise((resolve) => setTimeout(resolve, 20));
      const source = document.querySelector('#privacy') as HTMLSelectElement;
      const optionIds = Array.from(source.options, (option) =>
        win.rrweb.record.mirror.getId(option),
      );
      const indices = (select: HTMLSelectElement) =>
        Array.from(select.options).flatMap((option, index) =>
          option.selected ? [index] : [],
        );
      const liveIndices = indices(source);
      win.rrweb.record.addCustomEvent('end', null);
      win.stop();
      const inputs = win.events.flatMap((event) =>
        event.type === 3 && event.data.source === 5
          ? [event.data as inputData]
          : [],
      );
      const replayer = new win.rrweb.Replayer(win.events, {
        useVirtualDom: mode !== 'seek-real',
      });
      let restores = 0;
      const frameWin = replayer.iframe.contentWindow as Window &
        typeof globalThis;
      const descriptor = Object.getOwnPropertyDescriptor(
        frameWin.HTMLSelectElement.prototype,
        'selectedIndex',
      )!;
      if (watchRestores) {
        Object.defineProperty(
          frameWin.HTMLSelectElement.prototype,
          'selectedIndex',
          {
            ...descriptor,
            set(this: HTMLSelectElement, value: number) {
              if (this.id === 'privacy' && this.options.length > 0) restores++;
              descriptor.set!.call(this, value);
            },
          },
        );
      }
      if (mode === 'play') {
        await new Promise<void>((resolve) => {
          replayer.on('finish', () => resolve());
          replayer.play();
        });
      } else {
        replayer.pause(
          win.events[win.events.length - 1].timestamp -
            win.events[0].timestamp +
            1,
        );
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const replayed = replayer.iframe.contentDocument!.querySelector(
        '#privacy',
      ) as HTMLSelectElement;
      const result = {
        liveIndices,
        replayIndices: indices(replayed),
        replayValues: Array.from(
          replayed.selectedOptions,
          (option) => option.value,
        ),
        optionIds,
        inputs,
        payload: JSON.stringify(win.events),
        restores,
      };
      if (watchRestores)
        Object.defineProperty(
          frameWin.HTMLSelectElement.prototype,
          'selectedIndex',
          descriptor,
        );
      replayer.destroy();
      return result;
    },
    { mode, watchRestores },
  );
}

describe('select review regressions', () => {
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

  for (const blocked of ['option', 'optgroup']) {
    it.each(['class', 'selector'])(
      `does not capture a blocked ${blocked} (%s)`,
      async (rule) => {
        await page.evaluate(
          ({ blocked, rule }) => {
            const win = window as unknown as TestWindow;
            document.querySelector('#fixture')!.innerHTML =
              '<select id="privacy"><option value="public">Public</option>' +
              '<optgroup label="Choices"><option value="blocked-option-secret">Hidden</option></optgroup></select>';
            const select = document.querySelector('select')!;
            const target =
              blocked === 'option'
                ? select.options[1]
                : select.querySelector('optgroup')!;
            if (rule === 'class') target.className = 'rr-block';
            else target.setAttribute('data-private', '');
            win.events = [];
            win.stop = win.rrweb.record({
              maskAllInputs: false,
              blockSelector: '[data-private]',
              emit: (event) => win.events.push(event),
            })!;
            select.options[1].selected = true;
          },
          { blocked, rule },
        );
        const result = await finishReplay(page, 'seek');
        expect(result.liveIndices).toEqual([1]);
        expect(result.inputs).toEqual([]);
        expect(result.payload).not.toContain('blocked-option-secret');
      },
    );
  }

  for (const blocked of ['option', 'optgroup']) {
    for (const rule of ['class', 'selector']) {
      it.each(['sibling assignment', 'selection loop'])(
        `filters the current single selection (${blocked}, ${rule}, %s)`,
        async (sequence) => {
          await page.evaluate(
            async ({ blocked, rule, sequence }) => {
              const win = window as unknown as TestWindow;
              document.querySelector('#fixture')!.innerHTML =
                '<select id="privacy"><option value="public">Public</option>' +
                '<optgroup label="Choices"><option value="single-selection-secret">Hidden</option></optgroup></select>';
              const select = document.querySelector('select')!;
              const target =
                blocked === 'option'
                  ? select.options[1]
                  : select.querySelector('optgroup')!;
              if (rule === 'class') target.className = 'rr-block';
              else target.setAttribute('data-private', '');
              win.events = [];
              win.stop = win.rrweb.record({
                maskAllInputs: false,
                blockSelector: '[data-private]',
                emit: (event) => win.events.push(event),
              })!;
              if (sequence === 'sibling assignment') {
                select.options[1].selected = true;
                await new Promise((resolve) => setTimeout(resolve, 20));
                select.options[0].selected = false;
              } else {
                for (const option of select.options)
                  option.selected = option.value === 'single-selection-secret';
              }
            },
            { blocked, rule, sequence },
          );
          const result = await finishReplay(page, 'seek');
          expect(result.liveIndices).toEqual([1]);
          expect(result.payload).not.toContain('single-selection-secret');
          expect(result.inputs.map((input) => input.text)).toEqual(['']);
          expect(result.inputs[0].selectedOptionIds).toEqual([]);
        },
      );
    }
  }

  it('reads each selected set once during a burst of option writes', async () => {
    const scans = await page.evaluate(async () => {
      const win = window as unknown as TestWindow;
      document.querySelector('#fixture')!.innerHTML =
        '<select id="privacy" multiple></select>';
      const select = document.querySelector('select')!;
      for (let i = 0; i < 100; i++)
        select.add(new Option(String(i), String(i)));
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'selectedOptions',
      )!;
      let scans = 0;
      Object.defineProperty(select, 'selectedOptions', {
        get() {
          scans++;
          return descriptor.get!.call(this);
        },
      });
      win.events = [];
      win.stop = win.rrweb.record({
        maskAllInputs: false,
        emit: (event) => win.events.push(event),
      })!;
      const before = scans;
      for (const option of select.options) option.selected = true;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return scans - before;
    });
    const result = await finishReplay(page, 'seek');
    expect(result.replayIndices).toEqual(
      Array.from({ length: 100 }, (_, index) => index),
    );
    expect(result.inputs).toHaveLength(1);
    expect(scans).toBe(1);
  });

  it('coalesces writes separately for each select', async () => {
    const ids = await page.evaluate(async () => {
      const win = window as unknown as TestWindow;
      document.querySelector('#fixture')!.innerHTML =
        '<select id="privacy" multiple><option value="a">A</option><option value="b">B</option></select>' +
        '<select id="other" multiple><option value="c">C</option><option value="d">D</option></select>';
      win.events = [];
      win.stop = win.rrweb.record({
        maskAllInputs: false,
        emit: (event) => win.events.push(event),
      })!;
      const selects = Array.from(document.querySelectorAll('select'));
      for (const select of selects) select.options[1].selected = true;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return selects.map((select) => ({
        select: win.rrweb.record.mirror.getId(select),
        option: win.rrweb.record.mirror.getId(select.options[1]),
      }));
    });
    const result = await finishReplay(page, 'seek');
    expect(result.replayIndices).toEqual([1]);
    expect(
      result.inputs.map((input) => ({
        select: input.id,
        option: input.selectedOptionIds?.[0],
      })),
    ).toEqual(ids);
  });

  it('does not scan or emit pending selections after teardown', async () => {
    const result = await page.evaluate(async () => {
      const win = window as unknown as TestWindow;
      document.querySelector('#fixture')!.innerHTML =
        '<select id="privacy" multiple><option value="a">A</option><option value="b">B</option></select>';
      const select = document.querySelector('select')!;
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'selectedOptions',
      )!;
      let stopped = false;
      let lateScans = 0;
      Object.defineProperty(select, 'selectedOptions', {
        get() {
          if (stopped) lateScans++;
          return descriptor.get!.call(this);
        },
      });
      const events: eventWithTime[] = [];
      const stop = win.rrweb.record({
        maskAllInputs: false,
        emit: (event) => events.push(event),
      })!;
      select.options[1].selected = true;
      await new Promise<void>((resolve) =>
        setTimeout(() => {
          stop();
          stopped = true;
          resolve();
        }, 0),
      );
      const countAtStop = events.length;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        lateScans,
        countAtStop,
        finalCount: events.length,
        applied: select.options[1].selected,
      };
    });
    expect(result.applied).toBe(true);
    expect(result.lateScans).toBe(0);
    expect(result.finalCount).toBe(result.countAtStop);
  });

  it('preserves error reporting for deferred input normalization', async () => {
    const errors = await page.evaluate(async () => {
      const win = window as unknown as TestWindow;
      document.querySelector('#fixture')!.innerHTML = '<input>';
      const input = document.querySelector('input')!;
      const errors: string[] = [];
      const stop = win.rrweb.record({
        emit: () => {},
        errorHandler: (error) => {
          errors.push(String(error));
          return true;
        },
      })!;
      Object.defineProperty(input, 'tagName', {
        get() {
          throw new Error('input-normalization-error');
        },
      });
      input.value = 'test';
      await new Promise((resolve) => setTimeout(resolve, 20));
      stop();
      return errors;
    });
    expect(errors).toContain('Error: input-normalization-error');
  });

  it('keeps native user changes marked as user-triggered', async () => {
    await page.evaluate(() => {
      const win = window as unknown as TestWindow;
      document.querySelector('#fixture')!.innerHTML =
        '<select id="privacy" size="2"><option value="a" selected>A</option><option value="b">B</option></select>';
      win.events = [];
      win.stop = win.rrweb.record({
        maskAllInputs: false,
        userTriggeredOnInput: true,
        emit: (event) => win.events.push(event),
      })!;
    });
    await page.click('#privacy option[value="b"]');
    const result = await finishReplay(page, 'seek');
    expect(result.liveIndices).toEqual([1]);
    expect(result.replayValues).toEqual(['b']);
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0].userTriggered).toBe(true);
  });

  for (const change of ['redundant', 'replace', 'clear']) {
    it.each<ReplayMode>(['play', 'seek', 'seek-real'])(
      `preserves a single selection after ${change} (%s)`,
      async (mode) => {
        await page.evaluate((change) => {
          const win = window as unknown as TestWindow;
          document.querySelector('#fixture')!.innerHTML =
            '<select id="privacy"><option value="">Empty</option>' +
            '<option value="same">First</option><option value="same">Second</option></select>';
          const select = document.querySelector('select')!;
          select.selectedIndex = change === 'replace' ? 1 : 2;
          win.events = [];
          win.stop = win.rrweb.record({
            maskAllInputs: false,
            emit: (event) => win.events.push(event),
          })!;
          if (change === 'clear') select.selectedIndex = -1;
          else select.options[2].selected = true;
        }, change);
        const result = await finishReplay(page, mode);
        const expected = change === 'clear' ? [] : [2];
        expect(result.liveIndices).toEqual(expected);
        expect(result.replayIndices).toEqual(expected);
        expect(result.inputs).toHaveLength(1);
        expect(result.inputs[0].selectedOptionIds).toEqual(
          expected.map((index) => result.optionIds[index]),
        );
      },
    );
  }

  it('deduplicates single selections by option identity, not equal values', async () => {
    await page.evaluate(async () => {
      const win = window as unknown as TestWindow;
      document.querySelector('#fixture')!.innerHTML =
        '<select id="privacy"><option value="same">First</option>' +
        '<option value="same" selected>Second</option></select>';
      const select = document.querySelector('select')!;
      win.events = [];
      win.stop = win.rrweb.record({
        maskAllInputs: false,
        emit: (event) => win.events.push(event),
      })!;
      for (const index of [1, 0, 1, 1]) {
        select.options[index].selected = true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    });
    const result = await finishReplay(page, 'seek');
    expect(result.liveIndices).toEqual([1]);
    expect(result.replayIndices).toEqual([1]);
    expect(result.inputs.map((input) => input.selectedOptionIds)).toEqual(
      [1, 0, 1].map((index) => [result.optionIds[index]]),
    );
  });

  it('restores one selected option without rewriting every option flag', async () => {
    const result = await page.evaluate(async () => {
      const win = window as unknown as TestWindow;
      document.querySelector('#fixture')!.innerHTML =
        '<select id="privacy"></select>';
      const source = document.querySelector('select')!;
      for (let i = 0; i < 100; i++) source.add(new Option(String(i), 'same'));
      source.selectedIndex = 99;
      const events: eventWithTime[] = [];
      const stop = win.rrweb.record({
        maskAllInputs: false,
        emit: (event) => events.push(event),
      })!;
      source.options[99].selected = true;
      await new Promise((resolve) => setTimeout(resolve, 20));
      win.rrweb.record.addCustomEvent('end', null);
      stop();
      const replayer = new win.rrweb.Replayer(events);
      const frameWin = replayer.iframe.contentWindow as Window &
        typeof globalThis;
      let writes = 0;
      for (const [prototype, property] of [
        [frameWin.HTMLOptionElement.prototype, 'selected'],
        [frameWin.HTMLSelectElement.prototype, 'selectedIndex'],
      ] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(
          prototype,
          property,
        )!;
        Object.defineProperty(prototype, property, {
          ...descriptor,
          set(
            this: HTMLOptionElement | HTMLSelectElement,
            value: boolean | number,
          ) {
            if (this.id === 'privacy' || this.parentElement?.id === 'privacy')
              writes++;
            descriptor.set!.call(this, value);
          },
        });
      }
      replayer.pause(
        events[events.length - 1].timestamp - events[0].timestamp + 1,
      );
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const selectedIndex =
        replayer.iframe.contentDocument!.querySelector('select')!.selectedIndex;
      replayer.destroy();
      return { selectedIndex, writes };
    });
    expect(result.selectedIndex).toBe(99);
    expect(result.writes).toBeLessThanOrEqual(2);
  });

  it('replays legacy scalar-only single-select input events', async () => {
    await page.evaluate(() => {
      const win = window as unknown as TestWindow;
      document.querySelector('#fixture')!.innerHTML =
        '<select id="privacy"><option value="a">A</option><option value="b">B</option></select>';
      win.events = [];
      win.stop = win.rrweb.record({
        maskAllInputs: false,
        emit: (event) => {
          if (event.type === 3 && event.data.source === 5)
            delete event.data.selectedOptionIds;
          win.events.push(event);
        },
      })!;
      document.querySelector('select')!.options[1].selected = true;
    });
    const result = await finishReplay(page, 'seek');
    expect(result.liveIndices).toEqual([1]);
    expect(result.replayValues).toEqual(['b']);
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0]).not.toHaveProperty('selectedOptionIds');
  });

  for (const change of ['redundant', 'replace', 'clear', 'duplicate values']) {
    it.each<ReplayMode>(['play', 'seek', 'seek-real'])(
      `preserves a multiple selection after ${change} (%s)`,
      async (mode) => {
        await page.evaluate(
          ({ change }) => {
            const win = window as unknown as TestWindow;
            document.querySelector('#fixture')!.innerHTML =
              '<select id="privacy" multiple><option value="a" selected>A</option>' +
              '<option value="b">B</option><option value="c" selected>C</option></select>';
            const select = document.querySelector('select')!;
            if (change === 'duplicate values')
              for (const option of select.options) option.value = 'same';
            win.events = [];
            win.stop = win.rrweb.record({
              maskAllInputs: false,
              emit: (event) => win.events.push(event),
            })!;
          },
          { change },
        );
        await page.evaluate(async (change) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          const select = document.querySelector('select')!;
          if (change === 'redundant') select.options[0].selected = true;
          else if (change === 'clear')
            for (const option of select.options) option.selected = false;
          else {
            select.options[0].selected = false;
            select.options[1].selected = true;
          }
        }, change);
        const result = await finishReplay(page, mode);
        const expected =
          change === 'redundant' ? [0, 2] : change === 'clear' ? [] : [1, 2];
        expect(result.liveIndices).toEqual(expected);
        expect(result.replayIndices).toEqual(expected);
        expect(result.inputs).toHaveLength(1);
        expect(result.inputs[0].selectedOptionIds).toEqual(
          expected.map((index) => result.optionIds[index]),
        );
      },
    );
  }

  it('deduplicates the full selected set, not just the first value or its length', async () => {
    await page.evaluate(async () => {
      const win = window as unknown as TestWindow;
      document.querySelector('#fixture')!.innerHTML =
        '<select id="privacy" multiple><option value="a" selected>A</option>' +
        '<option value="b">B</option><option value="c" selected>C</option></select>';
      const select = document.querySelector('select')!;
      win.events = [];
      win.stop = win.rrweb.record({
        maskAllInputs: false,
        emit: (event) => win.events.push(event),
      })!;
      select.options[0].selected = true;
      await new Promise((resolve) => setTimeout(resolve, 20));
      select.options[2].selected = false;
      select.options[1].selected = true;
      await new Promise((resolve) => setTimeout(resolve, 20));
      select.options[1].selected = false;
      select.options[2].selected = true;
      await new Promise((resolve) => setTimeout(resolve, 20));
      select.options[0].selected = true;
    });
    const result = await finishReplay(page, 'seek');
    expect(result.inputs.map((input) => input.selectedOptionIds)).toEqual(
      [
        [0, 2],
        [0, 1],
        [0, 2],
      ].map((indices) => indices.map((index) => result.optionIds[index])),
    );
    expect(result.replayIndices).toEqual([0, 2]);
  });

  for (const multiple of [false, true]) {
    it.each<ReplayMode>(['play', 'seek', 'seek-real'])(
      `does not expose masked ${multiple ? 'multiple' : 'single'} selections (%s)`,
      async (mode) => {
        await page.evaluate((multiple) => {
          const win = window as unknown as TestWindow;
          document.querySelector('#fixture')!.innerHTML =
            `<select id="privacy" ${multiple ? 'multiple' : ''}><option value="a" selected>A</option>` +
            '<option value="b">B</option><option value="c" selected>C</option></select>';
          const select = document.querySelector('select')!;
          win.events = [];
          win.stop = win.rrweb.record({
            maskAllInputs: true,
            emit: (event) => win.events.push(event),
          })!;
          select.options[0].selected = false;
          select.options[1].selected = true;
        }, multiple);
        const result = await finishReplay(page, mode);
        expect(result.liveIndices).toEqual(multiple ? [1, 2] : [1]);
        expect(result.replayIndices).toEqual([]);
        expect(result.inputs).toHaveLength(1);
        expect(result.inputs[0].text).toBe('*');
        expect(result.inputs[0]).not.toHaveProperty('selectedOptionIds');
      },
    );
  }

  it.each(['option', 'optgroup'])(
    'excludes a blocked %s when another option changes',
    async (blocked) => {
      await page.evaluate(async (blocked) => {
        const win = window as unknown as TestWindow;
        const hidden =
          '<option value="blocked-selection-secret">Hidden</option>';
        document.querySelector('#fixture')!.innerHTML =
          '<select id="privacy" multiple>' +
          (blocked === 'option'
            ? '<option class="rr-block" value="blocked-selection-secret">Hidden</option>'
            : `<optgroup class="rr-block" label="Hidden">${hidden}</optgroup>`) +
          '<option value="b" selected>B</option><option value="c">C</option></select>';
        const select = document.querySelector('select')!;
        win.events = [];
        win.stop = win.rrweb.record({
          maskAllInputs: false,
          emit: (event) => win.events.push(event),
        })!;
        select.options[0].selected = true;
        await new Promise((resolve) => setTimeout(resolve, 20));
        select.options[2].selected = true;
      }, blocked);
      const result = await finishReplay(page, 'seek');
      expect(result.liveIndices).toEqual([0, 1, 2]);
      expect(result.replayValues).toEqual(['b', 'c']);
      expect(result.inputs).toHaveLength(1);
      expect(result.inputs[0].text).toBe('b');
      expect(result.inputs[0].selectedOptionIds).toEqual([
        result.optionIds[1],
        result.optionIds[2],
      ]);
      expect(result.payload).not.toContain('blocked-selection-secret');
    },
  );

  for (const multiple of [false, true]) {
    for (const removal of ['option', 'grouped option', 'optgroup']) {
      it.each<ReplayMode>(['play', 'seek', 'seek-real'])(
        `keeps a masked select blank after ${removal} removal (multiple: ${multiple}, %s)`,
        async (mode) => {
          await page.evaluate(
            async ({ multiple, removal }) => {
              const win = window as unknown as TestWindow;
              const first = '<option value="*">All</option>';
              document.querySelector('#fixture')!.innerHTML =
                `<select id="privacy" ${multiple ? 'multiple' : ''}>` +
                (removal === 'option'
                  ? first
                  : `<optgroup label="First">${first}</optgroup>`) +
                '<option value="private">Private</option></select>';
              const select = document.querySelector('select')!;
              select.options[0].selected = true;
              win.events = [];
              win.stop = win.rrweb.record({
                maskAllInputs: true,
                emit: (event) => win.events.push(event),
              })!;
              await new Promise((resolve) => setTimeout(resolve, 20));
              if (removal === 'optgroup')
                select.querySelector('optgroup')!.remove();
              else select.options[0].remove();
            },
            { multiple, removal },
          );
          const result = await finishReplay(page, mode);
          expect(result.liveIndices).toEqual(multiple ? [] : [0]);
          expect(result.replayIndices).toEqual([]);
          expect(result.inputs).toEqual([]);
        },
      );
    }
  }

  it('restores a masked select once after a batch of option removals', async () => {
    await page.evaluate(async () => {
      const win = window as unknown as TestWindow;
      document.querySelector('#fixture')!.innerHTML =
        '<select id="privacy"></select>';
      const select = document.querySelector('select')!;
      for (let i = 0; i < 101; i++)
        select.add(new Option(String(i), String(i)));
      win.events = [];
      win.stop = win.rrweb.record({
        maskAllInputs: true,
        emit: (event) => win.events.push(event),
      })!;
      await new Promise((resolve) => setTimeout(resolve, 20));
      for (const option of Array.from(select.options).slice(0, 100))
        option.remove();
    });
    const result = await finishReplay(page, 'play', true);
    expect(result.liveIndices).toEqual([0]);
    expect(result.replayIndices).toEqual([]);
    expect(result.restores).toBeLessThanOrEqual(2);
  });

  for (const grouped of [false, true]) {
    it.each<ReplayMode>(['play', 'seek-real'])(
      `restores a masked select once per option mutation batch (grouped: ${grouped}, %s)`,
      async (mode) => {
        await page.evaluate(async (grouped) => {
          const win = window as unknown as TestWindow;
          document.querySelector('#fixture')!.innerHTML =
            '<select id="privacy"></select>';
          const select = document.querySelector('select')!;
          win.events = [];
          win.stop = win.rrweb.record({
            maskAllInputs: true,
            emit: (event) => win.events.push(event),
          })!;
          await new Promise((resolve) => setTimeout(resolve, 20));
          const fragment = document.createDocumentFragment();
          for (let group = 0; group < 2; group++) {
            const parent = grouped
              ? document.createElement('optgroup')
              : fragment;
            for (let i = 0; i < 50; i++)
              parent.appendChild(
                new Option(String(group * 50 + i), String(group * 50 + i)),
              );
            if (grouped) fragment.appendChild(parent);
          }
          select.appendChild(fragment);
        }, grouped);
        const result = await finishReplay(page, mode, true);
        expect(result.replayIndices).toEqual([]);
        expect(result.restores).toBeLessThanOrEqual(1);
      },
    );
  }
});
