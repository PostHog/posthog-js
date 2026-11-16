/**
 * @vitest-environment jsdom
 */
import { snapshot, visitSnapshot } from '@posthog/rrweb-snapshot';
import { EventType, IncrementalSource, NodeType } from '@posthog/rrweb-types';
import type { eventWithTime, serializedNodeWithId } from '@posthog/rrweb-types';
import type { recordOptions } from '../../src/types';
import record from '../../src/record';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const cases: {
  name: string;
  options: recordOptions<eventWithTime>;
  expected: (value: string) => string;
}[] = [
  {
    name: 'all inputs',
    options: { maskAllInputs: true },
    expected: (value) => '*'.repeat(value.length),
  },
  {
    name: 'custom callback',
    options: { maskAllInputs: true, maskInputFn: () => '[masked]' },
    expected: () => '[masked]',
  },
  {
    name: 'explicit hidden option',
    options: { maskInputOptions: { hidden: true } },
    expected: (value) => '*'.repeat(value.length),
  },
  {
    name: 'masking disabled',
    options: { maskAllInputs: false },
    expected: (value) => value,
  },
  {
    name: 'hidden option disabled',
    options: { maskInputOptions: { hidden: false } },
    expected: (value) => value,
  },
];

function hiddenValue(node: serializedNodeWithId): unknown {
  let value: unknown;
  visitSnapshot(node, (node) => {
    if (node.type === NodeType.Element && node.attributes.type === 'hidden')
      value = node.attributes.value;
  });
  return value;
}

describe('hidden input masking', () => {
  let stop: (() => void) | undefined;
  let events: eventWithTime[];

  beforeEach(() => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36',
    );
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
    document.body.innerHTML = '<input type="hidden" value="initial">';
    events = [];
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each(cases)(
    'applies $name to the initial recorded value',
    ({ options, expected }) => {
      stop = record({ emit: (event) => events.push(event), ...options });
      const full = events.find(
        (event) => event.type === EventType.FullSnapshot,
      )!;
      if (full.type !== EventType.FullSnapshot)
        throw new Error('missing snapshot');
      expect(hiddenValue(full.data.node)).toBe(expected('initial'));
    },
  );

  it.each(cases)(
    'applies $name to later value mutations',
    async ({ options, expected }) => {
      stop = record({ emit: (event) => events.push(event), ...options });
      events = [];
      const input = document.querySelector('input')!;
      input.setAttribute('value', 'updated value');
      await settle();
      const attributes = events.flatMap((event) =>
        event.type === EventType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
          ? event.data.attributes
          : [],
      );
      expect(attributes).toContainEqual({
        id: record.mirror.getId(input),
        attributes: { value: expected('updated value') },
      });
    },
  );

  it('masks hidden values in a standalone snapshot', () => {
    expect(hiddenValue(snapshot(document, { maskAllInputs: true })!)).toBe(
      '*******',
    );
  });

  it('uses the custom callback in a standalone snapshot', () => {
    expect(
      hiddenValue(
        snapshot(document, {
          maskAllInputs: true,
          maskInputFn: () => '[masked]',
        })!,
      ),
    ).toBe('[masked]');
  });
});
