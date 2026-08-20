/**
 * @vitest-environment jsdom
 */
import {
  describe,
  it,
  test,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from 'vitest';
import {
  createMirror,
  createStylesheetTextCursor,
  escapeImportStatement,
  extractFileExtension,
  fixSafariColons,
  hasEmptyShorthandLonghand,
  isNodeMetaEqual,
  recompressBase64Image,
  stringifyStylesheet,
} from '../src/utils';
import { NodeType } from '@posthog/rrweb-types';
import type {
  serializedNode,
  serializedNodeWithId,
} from '@posthog/rrweb-types';

describe('utils', () => {
  describe('isNodeMetaEqual()', () => {
    const document1: serializedNode = {
      type: NodeType.Document,
      compatMode: 'CSS1Compat',
      childNodes: [],
    };
    const document2: serializedNode = {
      type: NodeType.Document,
      compatMode: 'BackCompat',
      childNodes: [],
    };
    const documentType1: serializedNode = {
      type: NodeType.DocumentType,
      name: 'html',
      publicId: '',
      systemId: '',
    };
    const documentType2: serializedNode = {
      type: NodeType.DocumentType,
      name: 'html',
      publicId: '',
      systemId: 'http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd',
    };
    const text1: serializedNode = {
      type: NodeType.Text,
      textContent: 'Hello World',
    };
    const text2: serializedNode = {
      type: NodeType.Text,
      textContent: 'Hello world',
    };
    const comment1: serializedNode = {
      type: NodeType.Comment,
      textContent: 'Hello World',
    };
    const comment2: serializedNode = {
      type: NodeType.Comment,
      textContent: 'Hello world',
    };
    const element1: serializedNode = {
      type: NodeType.Element,
      tagName: 'div',
      attributes: {
        className: 'test',
      },
      childNodes: [],
    };
    const element2: serializedNode = {
      type: NodeType.Element,
      tagName: 'span',
      attributes: {
        'aria-label': 'Hello World',
      },
      childNodes: [],
    };
    const element3: serializedNode = {
      type: NodeType.Element,
      tagName: 'div',
      attributes: { id: 'test' },
      childNodes: [comment1 as serializedNodeWithId],
    };

    it('should return false if two nodes have different node types', () => {
      expect(
        isNodeMetaEqual(
          undefined as unknown as serializedNode,
          null as unknown as serializedNode,
        ),
      ).toBeFalsy();
      expect(isNodeMetaEqual(document1, element1)).toBeFalsy();
      expect(isNodeMetaEqual(document1, documentType1)).toBeFalsy();
      expect(isNodeMetaEqual(documentType1, element1)).toBeFalsy();
      expect(isNodeMetaEqual(text1, comment1)).toBeFalsy();
      expect(isNodeMetaEqual(text1, element1)).toBeFalsy();
      expect(isNodeMetaEqual(comment1, element1)).toBeFalsy();
    });

    it('should compare meta data of two document nodes', () => {
      expect(
        isNodeMetaEqual(document1, JSON.parse(JSON.stringify(document1))),
      ).toBeTruthy();
      expect(
        isNodeMetaEqual(JSON.parse(JSON.stringify(document2)), document2),
      ).toBeTruthy();
      expect(isNodeMetaEqual(document1, document2)).toBeFalsy();
    });

    it('should compare meta data of two documentType nodes', () => {
      expect(
        isNodeMetaEqual(
          documentType1,
          JSON.parse(JSON.stringify(documentType1)),
        ),
      ).toBeTruthy();
      expect(
        isNodeMetaEqual(
          JSON.parse(JSON.stringify(documentType2)),
          documentType2,
        ),
      ).toBeTruthy();
      expect(isNodeMetaEqual(documentType1, documentType2)).toBeFalsy();
    });

    it('should compare meta data of two text nodes', () => {
      expect(
        isNodeMetaEqual(text1, JSON.parse(JSON.stringify(text1))),
      ).toBeTruthy();
      expect(
        isNodeMetaEqual(JSON.parse(JSON.stringify(text2)), text2),
      ).toBeTruthy();
      expect(isNodeMetaEqual(text1, text2)).toBeFalsy();
    });

    it('should compare meta data of two comment nodes', () => {
      expect(
        isNodeMetaEqual(comment1, JSON.parse(JSON.stringify(comment1))),
      ).toBeTruthy();
      expect(
        isNodeMetaEqual(JSON.parse(JSON.stringify(comment2)), comment2),
      ).toBeTruthy();
      expect(isNodeMetaEqual(comment1, comment2)).toBeFalsy();
    });

    it('should compare meta data of two HTML elements', () => {
      expect(
        isNodeMetaEqual(element1, JSON.parse(JSON.stringify(element1))),
      ).toBeTruthy();
      expect(
        isNodeMetaEqual(JSON.parse(JSON.stringify(element2)), element2),
      ).toBeTruthy();
      expect(
        isNodeMetaEqual(element1, {
          ...element1,
          childNodes: [comment2 as serializedNodeWithId],
        }),
      ).toBeTruthy();
      expect(isNodeMetaEqual(element1, element2)).toBeFalsy();
      expect(isNodeMetaEqual(element1, element3)).toBeFalsy();
      expect(isNodeMetaEqual(element2, element3)).toBeFalsy();
    });
  });
  describe('extractFileExtension', () => {
    test('absolute path', () => {
      const path = 'https://example.com/styles/main.css';
      const extension = extractFileExtension(path);
      expect(extension).toBe('css');
    });

    test('relative path', () => {
      const path = 'styles/main.css';
      const baseURL = 'https://example.com/';
      const extension = extractFileExtension(path, baseURL);
      expect(extension).toBe('css');
    });

    test('path with search parameters', () => {
      const path = 'https://example.com/scripts/app.js?version=1.0';
      const extension = extractFileExtension(path);
      expect(extension).toBe('js');
    });

    test('path with fragment', () => {
      const path = 'https://example.com/styles/main.css#section1';
      const extension = extractFileExtension(path);
      expect(extension).toBe('css');
    });

    test('path with search parameters and fragment', () => {
      const path = 'https://example.com/scripts/app.js?version=1.0#section1';
      const extension = extractFileExtension(path);
      expect(extension).toBe('js');
    });

    test('path without extension', () => {
      const path = 'https://example.com/path/to/directory/';
      const extension = extractFileExtension(path);
      expect(extension).toBeNull();
    });

    test('invalid URL', () => {
      const path = '!@#$%^&*()';
      const baseURL = 'invalid';
      const extension = extractFileExtension(path, baseURL);
      expect(extension).toBeNull();
    });

    test('path with multiple dots', () => {
      const path = 'https://example.com/scripts/app.min.js?version=1.0';
      const extension = extractFileExtension(path);
      expect(extension).toBe('js');
    });
  });

  describe('escapeImportStatement', () => {
    it('parses imports with quotes correctly', () => {
      const out1 = escapeImportStatement({
        cssText: `@import url("/foo.css;900;800"");`,
        href: '/foo.css;900;800"',
        media: {
          length: 0,
        },
        layerName: null,
        supportsText: null,
      } as unknown as CSSImportRule);
      expect(out1).toEqual(`@import url("/foo.css;900;800\\"");`);

      const out2 = escapeImportStatement({
        cssText: `@import url("/foo.css;900;800"") supports(display: flex);`,
        href: '/foo.css;900;800"',
        media: {
          length: 0,
        },
        layerName: null,
        supportsText: 'display: flex',
      } as unknown as CSSImportRule);
      expect(out2).toEqual(
        `@import url("/foo.css;900;800\\"") supports(display: flex);`,
      );

      const out3 = escapeImportStatement({
        cssText: `@import url("/foo.css;900;800"");`,
        href: '/foo.css;900;800"',
        media: {
          length: 1,
          mediaText: 'print, screen',
        },
        layerName: null,
        supportsText: null,
      } as unknown as CSSImportRule);
      expect(out3).toEqual(`@import url("/foo.css;900;800\\"") print, screen;`);

      const out4 = escapeImportStatement({
        cssText: `@import url("/foo.css;900;800"") layer(layer-1);`,
        href: '/foo.css;900;800"',
        media: {
          length: 0,
        },
        layerName: 'layer-1',
        supportsText: null,
      } as unknown as CSSImportRule);
      expect(out4).toEqual(
        `@import url("/foo.css;900;800\\"") layer(layer-1);`,
      );

      const out5 = escapeImportStatement({
        cssText: `@import url("/foo.css;900;800"") layer;`,
        href: '/foo.css;900;800"',
        media: {
          length: 0,
        },
        layerName: '',
        supportsText: null,
      } as unknown as CSSImportRule);
      expect(out5).toEqual(`@import url("/foo.css;900;800\\"") layer;`);
    });
  });
  describe('fixSafariColons', () => {
    it('parses : in attribute selectors correctly', () => {
      const out1 = fixSafariColons('[data-foo] { color: red; }');
      expect(out1).toEqual('[data-foo] { color: red; }');

      const out2 = fixSafariColons('[data-foo:other] { color: red; }');
      expect(out2).toEqual('[data-foo\\:other] { color: red; }');

      const out3 = fixSafariColons('[data-aa\\:other] { color: red; }');
      expect(out3).toEqual('[data-aa\\:other] { color: red; }');
    });
  });

  describe('hasEmptyShorthandLonghand', () => {
    it.each([
      ['padding-top: ;'],
      ['padding-top:;'],
      ['{ padding-top: ; padding-right: ; padding-left: ; }'],
      [
        '.x { padding-top: ; padding-bottom: var(--p); }',
      ],
      ['margin-left:;color: red;'],
      ['-webkit-mask-image: ;'],
      ['{ -moz-padding-start: ; }'],
    ])('detects corruption in %j', (css) => {
      expect(hasEmptyShorthandLonghand(css)).toBe(true);
    });

    it.each([
      [''],
      ['.x { padding: 8px; }'],
      ['.x { padding: var(--p); padding-bottom: var(--pb); }'],
      ['.x { content: ""; }'],
      ['.x { --foo: ; }'],
      ['.x { --my-prop: ; padding: 8px; }'],
    ])('does not flag %j', (css) => {
      expect(hasEmptyShorthandLonghand(css)).toBe(false);
    });
  });

  describe('stringifyStylesheet', () => {
    it('returns null if rules are missing', () => {
      const mockSheet = {
        rules: null,
        cssRules: null,
      } as unknown as CSSStyleSheet;
      expect(stringifyStylesheet(mockSheet)).toBeNull();
    });

    it('stringifies rules using .cssRules if .rules is missing', () => {
      const mockRule1 = { cssText: 'div { margin: 0; }' } as CSSRule;
      const mockSheet = {
        cssRules: [mockRule1],
        href: 'https://example.com/main.css',
      } as unknown as CSSStyleSheet;
      expect(stringifyStylesheet(mockSheet)).toBe('div { margin: 0; }');
    });

    it('uses ownerNode.baseURI for inline styles', () => {
      const mockFontFaceRule = {
        cssText: `
          @font-face {
            font-family: 'MockFont';
            src: url('../fonts/mockfont.woff2') format('woff2');
            font-weight: normal;
            font-style: normal;
          }
        `,
      } as CSSRule;
      const mockOwnerNode = {
        baseURI: 'https://example.com/fonts/',
      } as unknown as Node;
      const mockSheet = {
        cssRules: [mockFontFaceRule],
        href: null,
        ownerNode: mockOwnerNode,
      } as unknown as CSSStyleSheet;
      expect(
        stringifyStylesheet(mockSheet)?.replace(/\s+/g, ' ').trim(),
      ).toEqual(
        "@font-face { font-family: 'MockFont'; src: url('https://example.com/fonts/mockfont.woff2') format('woff2'); font-weight: normal; font-style: normal; }",
      );
    });
  });

  describe('createStylesheetTextCursor', () => {
    const makeRules = (count: number, prefix = 'r') =>
      Array.from({ length: count }, (_, i) => ({
        cssText: `.${prefix}${i} { background: url("img/${prefix}${i}.png"); }`,
      })) as unknown as CSSRule[];

    const makeSheet = (
      rules: unknown[],
      href: string | null = 'https://example.com/main.css',
    ) => ({ cssRules: rules, href }) as unknown as CSSStyleSheet;

    it('stringifies a large sheet in bounded slices, byte-identical to the single pass', () => {
      const sheet = makeSheet(makeRules(1000));
      const singlePass = stringifyStylesheet(sheet);
      expect(singlePass).toBeTruthy();

      const cursor = createStylesheetTextCursor(sheet);
      let boundedSlices = 0;
      while (!cursor.advance(100)) {
        boundedSlices += 1;
        expect(cursor.text()).toBeNull();
      }
      // exactly 100 rules per slice: 10 bounded slices, then the final call
      // that assembles the text
      expect(boundedSlices).toBe(10);
      expect(cursor.text()).toBe(singlePass);
    });

    it('slices across an @import chain and matches the single pass', () => {
      const inner = makeSheet(makeRules(20, 'inner'), 'https://example.com/inner.css');
      const innerImport = {
        styleSheet: inner,
        cssText: '@import url("inner.css");',
        href: 'inner.css',
        media: { length: 0 },
        layerName: null,
        supportsText: null,
      } as unknown as CSSRule;
      const imported = makeSheet(
        [...makeRules(20, 'mid'), innerImport, ...makeRules(20, 'mid2')],
        'https://example.com/imported.css',
      );
      const importRule = {
        styleSheet: imported,
        cssText: '@import url("imported.css");',
        href: 'imported.css',
        media: { length: 0 },
        layerName: null,
        supportsText: null,
      } as unknown as CSSRule;
      const sheet = makeSheet([
        ...makeRules(5, 'top'),
        importRule,
        ...makeRules(5, 'tail'),
      ]);

      const singlePass = stringifyStylesheet(sheet);
      expect(singlePass).toContain('inner0');

      const cursor = createStylesheetTextCursor(sheet);
      let boundedSlices = 0;
      while (!cursor.advance(10)) {
        boundedSlices += 1;
        expect(cursor.text()).toBeNull();
      }
      // 72 rules in total (import rules included), so slice boundaries fall
      // inside the imported sheets and the chain is resumed mid-descent
      expect(boundedSlices).toBeGreaterThanOrEqual(7);
      expect(cursor.text()).toBe(singlePass);
    });

    it('terminates on cyclic @import graphs, falling back to the import statement', () => {
      const parentRules: unknown[] = [...makeRules(3, 'parent')];
      const parent = makeSheet(parentRules, 'https://example.com/parent.css');
      const child = makeSheet(
        [
          ...makeRules(3, 'child'),
          {
            styleSheet: parent,
            cssText: '@import url(parent.css);',
            href: 'parent.css',
            media: { length: 0 },
            layerName: null,
            supportsText: null,
          },
        ],
        'https://example.com/child.css',
      );
      parentRules.push({
        styleSheet: child,
        cssText: '@import url(child.css);',
        href: 'child.css',
        media: { length: 0 },
        layerName: null,
        supportsText: null,
      });

      const cursor = createStylesheetTextCursor(parent);
      let calls = 0;
      while (!cursor.advance(2) && calls < 100) {
        calls += 1;
      }
      const text = cursor.text();
      expect(text).toContain('child2');
      // the cycle-closing import is emitted as a statement, not descended
      expect(text).toContain('@import url(https://example.com/parent.css)');
    });

    it('is immune to live CSSRuleList mutation between slices', () => {
      const rules = makeRules(300);
      const singlePass = stringifyStylesheet(makeSheet([...rules]));
      const cursor = createStylesheetTextCursor(makeSheet(rules));
      expect(cursor.advance(100)).toBe(false);

      // application code mutates the sheet mid-deferral, as
      // insertRule()/deleteRule() would between idle slices
      rules.splice(0, 50);
      rules.push({
        cssText: '.inserted { color: blue; }',
      } as unknown as CSSRule);

      while (!cursor.advance(100)) {
        // drain
      }
      // the cursor snapshots the rule list when it opens the sheet, so the
      // text matches the sheet as it was at defer time; the later CSSOM
      // mutations are recorded by the StyleSheetRule observer instead
      expect(cursor.text()).toBe(singlePass);
    });

    it('snapshots the whole @import chain at creation, not when traversal reaches it', () => {
      const importedRules = makeRules(20, 'imported');
      const imported = makeSheet(
        importedRules,
        'https://example.com/imported.css',
      );
      const importRule = {
        styleSheet: imported,
        cssText: '@import url("imported.css");',
        href: 'imported.css',
        media: { length: 0 },
        layerName: null,
        supportsText: null,
      } as unknown as CSSRule;
      const sheet = makeSheet([...makeRules(150, 'top'), importRule]);
      const singlePass = stringifyStylesheet(sheet);

      const cursor = createStylesheetTextCursor(sheet);
      // application code mutates the imported sheet mid-deferral, before the
      // traversal has reached the @import rule
      importedRules.splice(0, 10);
      importedRules.push({
        cssText: '.late-insert { color: blue; }',
      } as unknown as CSSRule);

      while (!cursor.advance(100)) {
        // drain
      }
      // defer-time semantics: the emitted text reflects the chain as it was
      // when the cursor was created, exactly like a synchronous pass then
      expect(cursor.text()).toBe(singlePass);
      expect(cursor.text()).not.toContain('.late-insert');
    });

    it('descends grouping rules in bounded slices, byte-identical to the single pass', () => {
      const ruleCount = 5000;
      const styleEl = document.createElement('style');
      styleEl.textContent = [
        '@media (min-width: 500px) {',
        ...Array.from(
          { length: ruleCount },
          (_, i) => `.m${i} { background: url("img/m${i}.png"); }`,
        ),
        '}',
        '@supports (display: flex) { .flexy { display: flex; } }',
        '.tail { color: red; }',
      ].join('\n');
      document.head.appendChild(styleEl);
      try {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const sheet = styleEl.sheet!;
        const singlePass = stringifyStylesheet(sheet);
        expect(singlePass).toContain('@media (min-width: 500px)');
        expect(singlePass).toContain('@supports (display: flex)');

        const cursor = createStylesheetTextCursor(sheet);
        let boundedSlices = 0;
        while (!cursor.advance(100)) {
          boundedSlices += 1;
        }
        // the @media children are traversed rule-by-rule, not serialized as
        // one synchronous cssText read charged as a single cursor step
        expect(boundedSlices).toBeGreaterThanOrEqual(ruleCount / 100);
        expect(cursor.text()).toBe(singlePass);
      } finally {
        styleEl.remove();
      }
    });

    it('descends a real @keyframes rule resumably, whitespace-equivalent to the single pass', () => {
      // jsdom's cssom joins keyframe children with its own whitespace, so the
      // reassembled text is compared whitespace-normalized - the documented
      // divergence class for grouping rules
      const styleEl = document.createElement('style');
      styleEl.textContent = [
        '@keyframes spin {',
        ...Array.from(
          { length: 200 },
          (_, i) => `${i / 2}% { opacity: ${i / 200}; }`,
        ),
        '}',
        '.tail { color: red; }',
      ].join('\n');
      document.head.appendChild(styleEl);
      try {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const sheet = styleEl.sheet!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const singlePass = stringifyStylesheet(sheet)!;
        expect(singlePass).toContain('@keyframes spin');

        const cursor = createStylesheetTextCursor(sheet);
        let boundedSlices = 0;
        while (!cursor.advance(50)) {
          boundedSlices += 1;
        }
        // the keyframes were traversed child-by-child across several slices
        expect(boundedSlices).toBeGreaterThanOrEqual(3);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const text = cursor.text()!;
        expect(text).toContain('@keyframes spin {');
        expect(text.replace(/\s+/g, '')).toBe(singlePass.replace(/\s+/g, ''));
      } finally {
        styleEl.remove();
      }
    });

    it('descends @layer blocks resumably instead of serializing the subtree one-shot', () => {
      let childReads = 0;
      const children = Array.from({ length: 500 }, (_, i) => ({
        get cssText() {
          childReads += 1;
          return `.layer-${i} { color: red; }`;
        },
      }));
      const namedLayer = {
        cssRules: children,
        name: 'framework.utilities', // dotted layer names are valid
        get cssText(): string {
          // the pre-slicing failure mode: one synchronous whole-subtree read
          throw new Error('whole-subtree serialization');
        },
      } as unknown as CSSRule;
      const anonymousLayer = {
        cssRules: [{ cssText: '.anon { color: blue; }' }],
        name: '',
        get cssText(): string {
          throw new Error('whole-subtree serialization');
        },
      } as unknown as CSSRule;

      const cursor = createStylesheetTextCursor(
        makeSheet([namedLayer, anonymousLayer], null),
      );
      let maxReadsPerSlice = 0;
      for (;;) {
        const before = childReads;
        const finished = cursor.advance(100);
        maxReadsPerSlice = Math.max(maxReadsPerSlice, childReads - before);
        if (finished) break;
      }

      expect(maxReadsPerSlice).toBeLessThanOrEqual(100);
      expect(childReads).toBe(500);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const text = cursor.text()!;
      expect(text).toContain('@layer framework.utilities {');
      expect(text).toContain('.layer-499');
      expect(text).toContain('@layer {.anon { color: blue; }}');
    });

    it('descends @container rules resumably, reconstructing the name that conditionText drops', () => {
      const named = {
        cssRules: [{ cssText: '.c { color: red; }' }],
        containerName: 'sidebar',
        containerQuery: '(min-width: 400px)',
        conditionText: '(min-width: 400px)',
        get cssText(): string {
          throw new Error('whole-subtree serialization');
        },
      } as unknown as CSSRule;
      const unnamed = {
        cssRules: [{ cssText: '.u { color: blue; }' }],
        containerName: '',
        containerQuery: '(max-width: 100px)',
        conditionText: '(max-width: 100px)',
        get cssText(): string {
          throw new Error('whole-subtree serialization');
        },
      } as unknown as CSSRule;

      const cursor = createStylesheetTextCursor(
        makeSheet([named, unnamed], null),
      );
      while (!cursor.advance(100)) {
        // drain
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const text = cursor.text()!;
      expect(text).toContain(
        '@container sidebar (min-width: 400px) {.c { color: red; }}',
      );
      expect(text).toContain(
        '@container (max-width: 100px) {.u { color: blue; }}',
      );
    });

    it('keeps the one-shot read for conditionText rules that are not @supports', () => {
      // a mock rule whose constructor carries the given browser class name;
      // plain objects pass the @supports gate, engine classes must match
      const asRuleType = (typeName: string, props: object): CSSRule => {
        const RuleClass = class {};
        Object.defineProperty(RuleClass, 'name', { value: typeName });
        const rule = new RuleClass();
        Object.defineProperties(rule, Object.getOwnPropertyDescriptors(props));
        return rule as unknown as CSSRule;
      };

      // CSSContainerRule on engines predating containerName/containerQuery
      // (Chrome 105-110, Safari 16.0): only conditionText, which in Chrome's
      // shape includes the name; an anonymous one wrapped as @supports would
      // even parse, silently un-conditionalizing the styles at replay
      const oldEngineContainer = asRuleType('CSSContainerRule', {
        cssRules: [{ cssText: '.old { color: red; }' }],
        conditionText: 'sidebar (min-width: 400px)',
        cssText:
          '@container sidebar (min-width: 400px) { .old { color: red; } }',
      });
      // Gecko keeps @-moz-document in author sheets for the Firefox CSS hack
      const mozDocument = asRuleType('CSSMozDocumentRule', {
        cssRules: [{ cssText: '.ff { color: red; }' }],
        conditionText: 'url-prefix()',
        cssText: '@-moz-document url-prefix() { .ff { color: red; } }',
      });

      const cursor = createStylesheetTextCursor(
        makeSheet([oldEngineContainer, mozDocument], null),
      );
      while (!cursor.advance(100)) {
        // drain
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const text = cursor.text()!;
      expect(text).toContain(
        '@container sidebar (min-width: 400px) { .old { color: red; } }',
      );
      expect(text).toContain(
        '@-moz-document url-prefix() { .ff { color: red; } }',
      );
      expect(text).not.toContain('@supports');
    });

    it('keeps the one-shot read for @function, whose name never fits a layer name', () => {
      // Chromium 139+: CSSFunctionRule has `name` and child cssRules; an
      // @layer prelude would erase the function on replay and register a
      // bogus cascade layer that can reorder the rest of the sheet
      const fn = {
        cssRules: [{ cssText: 'result: calc(-1 * var(--v));' }],
        name: '--negate',
        cssText: '@function --negate(--v) { result: calc(-1 * var(--v)); }',
      } as unknown as CSSRule;

      const cursor = createStylesheetTextCursor(makeSheet([fn], null));
      while (!cursor.advance(100)) {
        // drain
      }
      expect(cursor.text()).toContain(
        '@function --negate(--v) { result: calc(-1 * var(--v)); }',
      );
      expect(cursor.text()).not.toContain('@layer');
    });

    it('keeps the one-shot read for @container when containerQuery is unsupported', () => {
      let oneShotReads = 0;
      const rule = {
        cssRules: [{ cssText: '.c { color: red; }' }],
        containerName: 'sidebar',
        conditionText: '(min-width: 400px)', // the name is not part of this
        get cssText(): string {
          oneShotReads += 1;
          return '@container sidebar (min-width: 400px) { .c { color: red; } }';
        },
      } as unknown as CSSRule;

      const cursor = createStylesheetTextCursor(makeSheet([rule], null));
      while (!cursor.advance(100)) {
        // drain
      }
      expect(oneShotReads).toBe(1);
      expect(cursor.text()).toBe(
        '@container sidebar (min-width: 400px) { .c { color: red; } }',
      );
    });

    it('descends @keyframes resumably, one keyframe child per step', () => {
      let childReads = 0;
      const keyframes = Array.from({ length: 300 }, (_, i) => ({
        keyText: `${i}%`,
        get cssText() {
          childReads += 1;
          return `${i}% { opacity: ${i / 300}; }`;
        },
      }));
      const rule = {
        cssRules: keyframes,
        name: 'spin',
        get cssText(): string {
          throw new Error('whole-subtree serialization');
        },
      } as unknown as CSSRule;

      const cursor = createStylesheetTextCursor(makeSheet([rule], null));
      let maxReadsPerSlice = 0;
      for (;;) {
        const before = childReads;
        const finished = cursor.advance(100);
        maxReadsPerSlice = Math.max(maxReadsPerSlice, childReads - before);
        if (finished) break;
      }

      expect(maxReadsPerSlice).toBeLessThanOrEqual(100);
      expect(childReads).toBe(300);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const text = cursor.text()!;
      expect(text).toContain('@keyframes spin {');
      expect(text).toContain('299% { opacity: ');
    });

    it('descends natively-nested style rules resumably, declarations riding in the prelude', () => {
      let childReads = 0;
      const children = Array.from({ length: 300 }, (_, i) => ({
        get cssText() {
          childReads += 1;
          return `&.child-${i} { color: blue; }`;
        },
      }));
      const nested = {
        selectorText: '.card',
        style: { cssText: 'color: red; background: url("img/bg.png");' },
        cssRules: children,
        get cssText(): string {
          throw new Error('whole-subtree serialization');
        },
      } as unknown as CSSRule;

      const cursor = createStylesheetTextCursor(makeSheet([nested]));
      let maxReadsPerSlice = 0;
      for (;;) {
        const before = childReads;
        const finished = cursor.advance(100);
        maxReadsPerSlice = Math.max(maxReadsPerSlice, childReads - before);
        if (finished) break;
      }

      expect(maxReadsPerSlice).toBeLessThanOrEqual(100);
      expect(childReads).toBe(300);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const text = cursor.text()!;
      // the declaration block never appears among cssRules, so it must ride
      // in the prelude exactly once, absolutified against the sheet href
      expect(text).toContain(
        '.card { color: red; background: url("https://example.com/img/bg.png");',
      );
      expect(text).toContain('&.child-299');
      expect(text.endsWith('}')).toBe(true);
    });

    it('applies the Safari colon fix across a nested style rule subtree, like the single pass', () => {
      const nested = {
        selectorText: '[data:attr] .card',
        style: { cssText: 'color: red;' },
        cssRules: [{ cssText: '& [nested:attr] { color: blue; }' }],
        get cssText(): string {
          throw new Error('whole-subtree serialization');
        },
      } as unknown as CSSRule;

      const cursor = createStylesheetTextCursor(makeSheet([nested], null));
      while (!cursor.advance(100)) {
        // drain
      }
      // the single pass runs fixSafariColons over the whole top-level rule
      // text, nested children included; the reassembled frame must match
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const text = cursor.text()!;
      expect(text).toContain('[data\\:attr]');
      expect(text).toContain('[nested\\:attr]');
    });

    it('keeps the one-shot read for @page rules, which share selectorText with style rules', () => {
      let oneShotReads = 0;
      const pageRule = {
        selectorText: ':first',
        type: 6, // CSSRule.PAGE_RULE
        style: { cssText: 'margin: 1cm;' },
        cssRules: [{ cssText: '@top-center { content: "x"; }' }],
        get cssText(): string {
          oneShotReads += 1;
          return '@page :first { margin: 1cm; @top-center { content: "x"; } }';
        },
      } as unknown as CSSRule;

      const cursor = createStylesheetTextCursor(makeSheet([pageRule], null));
      while (!cursor.advance(100)) {
        // drain
      }
      expect(oneShotReads).toBe(1);
      expect(cursor.text()).toContain('@page :first {');
    });

    it('never serializes a grouping rule in one shot, and bounds child reads per slice', () => {
      let childReads = 0;
      const children = Array.from({ length: 1000 }, (_, i) => ({
        get cssText() {
          childReads += 1;
          return `.g${i} { color: red; }`;
        },
      }));
      const mediaRule = {
        cssRules: children,
        media: { mediaText: '(min-width: 500px)' },
        get cssText(): string {
          // the pre-slicing failure mode: one synchronous whole-subtree read
          throw new Error('whole-subtree serialization');
        },
      } as unknown as CSSRule;

      const cursor = createStylesheetTextCursor(makeSheet([mediaRule]));
      let maxReadsPerSlice = 0;
      for (;;) {
        const before = childReads;
        const finished = cursor.advance(100);
        maxReadsPerSlice = Math.max(maxReadsPerSlice, childReads - before);
        if (finished) break;
      }

      expect(maxReadsPerSlice).toBeLessThanOrEqual(100);
      expect(childReads).toBe(1000);
      const text = cursor.text();
      expect(text).toContain('@media (min-width: 500px) {');
      expect(text).toContain('.g999');
    });

    it('always advances at least one rule, even with a zero budget', () => {
      const cursor = createStylesheetTextCursor(makeSheet(makeRules(3)));
      let calls = 0;
      while (!cursor.advance(0) && calls < 10) {
        calls += 1;
      }
      expect(calls).toBeLessThanOrEqual(4);
      expect(cursor.text()).toBeTruthy();
    });

    it('is done immediately with null text for unreadable sheets', () => {
      const cursor = createStylesheetTextCursor({
        rules: null,
        cssRules: null,
      } as unknown as CSSStyleSheet);
      expect(cursor.advance(100)).toBe(true);
      expect(cursor.text()).toBeNull();
    });
  });

  describe('Mirror.removeNodeFromMap', () => {
    const createMeta = (id: number): serializedNodeWithId => ({
      type: NodeType.Element,
      tagName: 'div',
      attributes: {},
      childNodes: [],
      id,
    });

    it('removes regular child nodes from idNodeMap', () => {
      const mirror = createMirror();

      const parent = document.createElement('div');
      const child = document.createElement('span');
      const grandchild = document.createTextNode('hello');

      parent.appendChild(child);
      child.appendChild(grandchild);

      mirror.add(parent, createMeta(1));
      mirror.add(child, createMeta(2));
      mirror.add(grandchild, createMeta(3));

      expect(mirror.has(1)).toBe(true);
      expect(mirror.has(2)).toBe(true);
      expect(mirror.has(3)).toBe(true);

      mirror.removeNodeFromMap(parent);

      expect(mirror.has(1)).toBe(false);
      expect(mirror.has(2)).toBe(false);
      expect(mirror.has(3)).toBe(false);
    });

    it('removes shadow DOM children from idNodeMap', () => {
      const mirror = createMirror();

      const host = document.createElement('div');
      const shadowRoot = host.attachShadow({ mode: 'open' });
      const shadowChild = document.createElement('span');
      const shadowText = document.createTextNode('shadow content');

      shadowRoot.appendChild(shadowChild);
      shadowChild.appendChild(shadowText);

      mirror.add(host, createMeta(1));
      mirror.add(shadowRoot as unknown as Node, createMeta(2));
      mirror.add(shadowChild, createMeta(3));
      mirror.add(shadowText, createMeta(4));

      expect(mirror.has(1)).toBe(true);
      expect(mirror.has(2)).toBe(true);
      expect(mirror.has(3)).toBe(true);
      expect(mirror.has(4)).toBe(true);

      mirror.removeNodeFromMap(host);

      expect(mirror.has(1)).toBe(false);
      expect(mirror.has(2)).toBe(false);
      expect(mirror.has(3)).toBe(false);
      expect(mirror.has(4)).toBe(false);
    });

    it('removes iframe contentDocument children from idNodeMap', () => {
      const mirror = createMirror();

      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentDocument!;
      const iframeBody = iframeDoc.body;
      const iframeChild = iframeDoc.createElement('div');
      const iframeText = iframeDoc.createTextNode('iframe content');

      iframeBody.appendChild(iframeChild);
      iframeChild.appendChild(iframeText);

      mirror.add(iframe, createMeta(1));
      mirror.add(iframeDoc as unknown as Node, createMeta(2));
      mirror.add(iframeBody, createMeta(3));
      mirror.add(iframeChild, createMeta(4));
      mirror.add(iframeText, createMeta(5));

      expect(mirror.has(1)).toBe(true);
      expect(mirror.has(2)).toBe(true);
      expect(mirror.has(3)).toBe(true);
      expect(mirror.has(4)).toBe(true);
      expect(mirror.has(5)).toBe(true);

      mirror.removeNodeFromMap(iframe);

      expect(mirror.has(1)).toBe(false);
      expect(mirror.has(2)).toBe(false);
      expect(mirror.has(3)).toBe(false);
      expect(mirror.has(4)).toBe(false);
      expect(mirror.has(5)).toBe(false);

      document.body.removeChild(iframe);
    });
  });

  describe('recompressBase64Image()', () => {
    const makeImg = (
      naturalWidth: number,
      naturalHeight: number,
      complete = true,
    ) => {
      const img = document.createElement('img');
      Object.defineProperty(img, 'complete', { value: complete });
      Object.defineProperty(img, 'naturalWidth', { value: naturalWidth });
      Object.defineProperty(img, 'naturalHeight', { value: naturalHeight });
      return img;
    };
    // unique per call so the module-level memoization cache never leaks
    // state between tests
    let uniqueId = 0;
    const makeDataURL = (length: number) =>
      `data:image/png;base64,${'a'.repeat(length)}#${uniqueId++}`;

    let toDataURL: MockInstance;
    let getContext: MockInstance;

    beforeEach(() => {
      getContext = vi
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue({
          drawImage: vi.fn(),
        } as unknown as CanvasRenderingContext2D);
      toDataURL = vi
        .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
        .mockReturnValue('data:image/webp;base64,tiny');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('does not touch the canvas for data URLs too small to be worth recompressing', () => {
      const dataURL = makeDataURL(50_000);
      expect(
        recompressBase64Image(makeImg(4096, 3072), dataURL, 'image/webp', 0.4),
      ).toBe(dataURL);
      expect(getContext).not.toHaveBeenCalled();
      expect(toDataURL).not.toHaveBeenCalled();
    });

    it('recompresses large data URLs', () => {
      const dataURL = makeDataURL(200_000);
      expect(
        recompressBase64Image(makeImg(800, 600), dataURL, 'image/webp', 0.4),
      ).toBe('data:image/webp;base64,tiny');
      expect(toDataURL).toHaveBeenCalledWith('image/webp', 0.4);
    });

    it('keeps the original when recompression does not make it smaller', () => {
      const dataURL = makeDataURL(200_000);
      toDataURL.mockReturnValue(
        `data:image/webp;base64,${'b'.repeat(300_000)}`,
      );
      expect(recompressBase64Image(makeImg(800, 600), dataURL)).toBe(dataURL);
    });

    it('encodes each unique data URL only once', () => {
      const dataURL = makeDataURL(200_000);
      const img = makeImg(800, 600);
      const first = recompressBase64Image(img, dataURL, 'image/webp', 0.4);
      const second = recompressBase64Image(img, dataURL, 'image/webp', 0.4);
      expect(second).toBe(first);
      expect(toDataURL).toHaveBeenCalledTimes(1);
    });

    it('re-encodes when type or quality changes', () => {
      const dataURL = makeDataURL(200_000);
      const img = makeImg(800, 600);
      recompressBase64Image(img, dataURL, 'image/webp', 0.4);
      recompressBase64Image(img, dataURL, 'image/webp', 0.8);
      expect(toDataURL).toHaveBeenCalledTimes(2);
    });

    it('evicts only the oldest entry when the cache is full', () => {
      const img = makeImg(800, 600);
      // one more than MAX_RECOMPRESSION_CACHE_ENTRIES
      const dataURLs = Array.from({ length: 11 }, () =>
        makeDataURL(200_000),
      );
      for (const dataURL of dataURLs) {
        recompressBase64Image(img, dataURL, 'image/webp', 0.4);
      }
      expect(toDataURL).toHaveBeenCalledTimes(11);

      // the 10 most recent entries are still cached
      for (const dataURL of dataURLs.slice(1)) {
        recompressBase64Image(img, dataURL, 'image/webp', 0.4);
      }
      expect(toDataURL).toHaveBeenCalledTimes(11);

      // only the oldest entry was evicted and needs re-encoding
      recompressBase64Image(img, dataURLs[0], 'image/webp', 0.4);
      expect(toDataURL).toHaveBeenCalledTimes(12);
    });

    it('returns the original for images that are not loaded', () => {
      const dataURL = makeDataURL(200_000);
      expect(recompressBase64Image(makeImg(0, 0, false), dataURL)).toBe(
        dataURL,
      );
      expect(toDataURL).not.toHaveBeenCalled();
    });

    it('returns the original for images larger than the dimension cap', () => {
      const dataURL = makeDataURL(200_000);
      expect(recompressBase64Image(makeImg(5000, 3000), dataURL)).toBe(
        dataURL,
      );
      expect(toDataURL).not.toHaveBeenCalled();
    });
  });
});
