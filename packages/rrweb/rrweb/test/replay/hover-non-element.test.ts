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

describe('hoverElements', () => {
  let replayer: Replayer;

  beforeEach(() => {
    // Replayer needs at least 2 events.
    replayer = new Replayer([event(), event()]);
  });

  const hover = (node: Node): void =>
    (replayer as unknown as { hoverElements: (el: Node) => void }).hoverElements(
      node,
    );

  it('survives a repeated hover on a detached non-element node', () => {
    const detached = document.createTextNode('orphan');

    hover(detached);

    // The first hover caches getRootNode(), which for a detached text node is the
    // text node itself. The second is what used to call querySelectorAll on it.
    expect(() => hover(detached)).not.toThrow();
  });

  it('applies :hover to the ancestors of a non-element target', () => {
    const parent = document.createElement('div');
    const text = document.createTextNode('hi');
    parent.appendChild(text);
    document.body.appendChild(parent);

    hover(text);

    expect(parent.classList.contains(':hover')).toBe(true);
  });
});
