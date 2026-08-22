/**
 * @vitest-environment jsdom
 */
import { Replayer } from '../../src/replay';
import { EventType, eventWithTime } from '@posthog/rrweb-types';

const event = (): eventWithTime => ({
  timestamp: 1,
  type: EventType.DomContentLoaded,
  data: {},
});

describe('applyAdoptedStyleSheet', () => {
  let replayer: Replayer;

  beforeEach(() => {
    // Replayer needs at least 2 events.
    replayer = new Replayer([event(), event()]);
  });

  afterEach(() => {
    replayer.destroy();
  });

  it('keeps playing when the target document rejects the adoption', () => {
    const doc = replayer.iframe.contentDocument as Document;

    // Every engine rejects a constructed sheet whose owning document is not the
    // one adopting it. This is that rejection, with WebKit's wording.
    Object.defineProperty(doc, 'adoptedStyleSheets', {
      configurable: true,
      get: () => [],
      set: () => {
        throw new Error("Sheet constructor document doesn't match");
      },
    });

    (
      replayer as unknown as { mirror: { getNode: () => Node } }
    ).mirror.getNode = () => doc;

    const apply = (
      replayer as unknown as {
        applyAdoptedStyleSheet: (data: unknown) => void;
      }
    ).applyAdoptedStyleSheet.bind(replayer);

    expect(() =>
      apply({ id: 1, styleIds: [1], styles: [{ styleId: 1, rules: [] }] }),
    ).not.toThrow();
  });
});
