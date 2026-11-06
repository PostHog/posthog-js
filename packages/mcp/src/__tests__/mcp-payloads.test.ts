import {
  buildCapturedMcpParameters,
  redactPayloadPii,
  redactPii,
  sanitizeCapturedValue,
  sanitizeFreeText,
  sanitizeFreeTextValue,
} from '../extensions/mcp-payloads'

describe('buildCapturedMcpParameters', () => {
  it('captures useful tool-call inputs without transport internals or duplicated intent', () => {
    const parameters = buildCapturedMcpParameters({
      id: 102,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'projects-get',
        arguments: {
          context: 'Review local project access before inspecting MCP analytics capture results.',
          projectId: 1,
          api_token: 'phc_123456789012345678901234567890',
        },
      },
      extra: {
        requestInfo: {
          headers: {
            authorization: 'Bearer phx_123456789012345678901234567890',
          },
        },
        signal: {},
      },
    })

    expect(parameters).toEqual({
      request: {
        id: 102,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'projects-get',
          arguments: {
            projectId: 1,
            api_token: '[redacted]',
          },
        },
      },
    })
  })

  it('keeps a parsed __proto__ argument', () => {
    const request = JSON.parse('{"method":"tools/call","params":{"name":"t","arguments":{"__proto__":{"x":1}}}}')

    expect(JSON.stringify(buildCapturedMcpParameters(request))).toBe(
      '{"request":{"method":"tools/call","params":{"name":"t","arguments":{"__proto__":{"x":1}}}}}'
    )
  })

  it.each([100, 100_000])('reads no more than the entry limit of %i arguments', (count) => {
    let reads = 0
    const args: Record<string, unknown> = {}
    for (let index = 0; index < count; index++) {
      Object.defineProperty(args, `k${index}`, {
        enumerable: true,
        get: () => (reads++, `customer ${index} order ORD-${index}`),
      })
    }

    buildCapturedMcpParameters({ method: 'tools/call', params: { name: 't', arguments: args } })

    expect(reads).toBeLessThanOrEqual(200)
  })

  const realArguments = (count: number): [string, number][] =>
    Array.from({ length: count }, (_, index) => [`k${index}`, index])

  it.each([
    ['first', 100],
    ['first', 101],
    ['in the middle', 100],
    ['last', 100],
    ['last', 101],
    ['absent', 100],
    ['absent', 101],
  ])('keeps the first 100 real arguments with context %s among %i', (position, count) => {
    const real = realArguments(count)
    const context: [string, string][] = position === 'absent' ? [] : [['context', 'why']]
    const entries =
      position === 'first'
        ? [...context, ...real]
        : position === 'last'
          ? [...real, ...context]
          : [...real.slice(0, 50), ...context, ...real.slice(50)]

    const parameters = buildCapturedMcpParameters({
      method: 'tools/call',
      params: { name: 't', arguments: Object.fromEntries(entries) },
    }) as { request: { params: { arguments: Record<string, unknown> } } }

    expect(parameters.request.params.arguments).toEqual({
      ...Object.fromEntries(real.slice(0, 100)),
      ...(count > 100 ? { '...': '[MaxProperties ~]' } : {}),
    })
  })

  it('redacts PostHog tokens from captured string values', () => {
    const parameters = buildCapturedMcpParameters({
      method: 'tools/call',
      params: {
        name: 'projects-get',
        arguments: {
          summary: 'Default project token api_token: phc_123456789012345678901234567890.',
        },
      },
    })

    expect(JSON.stringify(parameters)).not.toContain('phc_')
    expect(parameters).toEqual({
      request: {
        method: 'tools/call',
        params: {
          name: 'projects-get',
          arguments: {
            summary: 'Default project token api_token: [redacted].',
          },
        },
      },
    })
  })
})

describe('URL credential redaction', () => {
  it.each([
    ['URL at length limit', `https://example.com/${'a/'.repeat(4086)}`, false],
    ['URL over length limit', `https://example.com/${'a/'.repeat(4086)}a`, true],
    ['query at field limit', `https://example.com/?${Array(128).fill('page=1').join('&')}`, false],
    ['query over field limit', `https://example.com/?${Array(129).fill('page=1').join('&')}`, true],
    ['empty query fields over limit', `https://example.com/?${'&'.repeat(128)}token=fakesecret`, true],
  ])('bounds parsing for %s', (_label, uri, oversized) => {
    const expected = oversized ? '[redacted]' : uri
    expect(sanitizeCapturedValue(uri)).toBe(expected)
    expect(sanitizeCapturedValue(`Cannot read ${uri}`)).toBe(`Cannot read ${expected}`)
  })

  it.each([
    [
      'https://example.com/guide?token=fakesecret&token=fakeaccess&empty=',
      'https://example.com/guide?token=%5Bredacted%5D&token=%5Bredacted%5D&empty=',
    ],
    [
      'https://example.com/guide?X-Goog-Credential=fakecredential&X-Goog-Signature=fakesignature',
      'https://example.com/guide?X-Goog-Credential=%5Bredacted%5D&X-Goog-Signature=%5Bredacted%5D',
    ],
    [
      'https://example.com/guide?sig=fakesignature&Signature=fakesignature&X-Amz-Security-Token=fakesecret',
      'https://example.com/guide?sig=%5Bredacted%5D&Signature=%5Bredacted%5D&X-Amz-Security-Token=%5Bredacted%5D',
    ],
    ['https://fakeuser@example.com/guide', 'https://%5Bredacted%5D@example.com/guide'],
    [
      'https://example.com/guide?%61=hello%20world&empty=#part',
      'https://example.com/guide?%61=hello%20world&empty=#part',
    ],
    [
      'Cannot read https://fakeuser:fakepass@example.com/guide or https://example.com/guide?token=fakesecret',
      'Cannot read https://%5Bredacted%5D@example.com/guide or https://example.com/guide?token=%5Bredacted%5D',
    ],
    ['https://fakeuser:fakepass@[invalid/guide?token=fakesecret', '[redacted]'],
    // `_` is a word character but not scheme-legal, so a `\b`-anchored pattern
    // would find no boundary here and leave the credentials in place.
    ['resource_https://fakeuser:fakepass@example.com/doc', 'resource_https://%5Bredacted%5D@example.com/doc'],
    [
      'https://app.example.com/cb#access_token=fakeaccess&token_type=bearer',
      'https://app.example.com/cb#access_token=%5Bredacted%5D&token_type=%5Bredacted%5D',
    ],
    // `;` is never split on: doing so cuts a credential's own value in two and
    // republishes the tail as a bare key. A value carrying one is dropped whole
    // instead, whenever any `;`-separated piece of it names a credential.
    ['https://example.com/guide?password=prefix;remainingsecret', 'https://example.com/guide?password=%5Bredacted%5D'],
    ['https://example.com/x?a=1;token=fakesecret', 'https://example.com/x?a=%5Bredacted%5D'],
    // A legacy `;` pair parses into one key, so `;` separates name segments too.
    ['https://example.com/?download;token=fakesecret', 'https://example.com/?download%3Btoken=%5Bredacted%5D'],
    // A `?` or `;` right after a field name may sit inside that field's value, so
    // an address after one stays attached and the field rules — which can see
    // the whole credential — decide, rather than being cut off as adjacent.
    [
      'https://example.com/#password=prefix?https://private.example/remainingsecret',
      'https://example.com/#password=%5Bredacted%5D?[redacted]',
    ],
    [
      'https://example.com/?password=prefix;https://private.example/remainingsecret',
      'https://example.com/?password=%5Bredacted%5D',
    ],
    // Attached, then sanitized as the tail's own text once the head proves benign.
    [
      'https://example.com/#/docs/id=1?https://fakeuser:fakepass@x.test/doc',
      'https://example.com/#/docs/id=1?https://%5Bredacted%5D@x.test/doc',
    ],
    // The head has no `=`, so it is text and survives; the tail is a field list.
    // Read as one, the whole fragment would be a single key `/callback?token`.
    ['https://example.com/#/callback?token=fakesecret', 'https://example.com/#/callback?token=%5Bredacted%5D'],
    // A fragment field list can be written with a leading slash, so `/` counts as
    // a segment separator in a key name. Re-serializing percent-encodes it.
    ['https://example.com/#/token=fakesecret', 'https://example.com/#%2Ftoken=%5Bredacted%5D'],
    // A `?` inside a credential looks exactly like the one between a route and
    // its fields, so when the head's last field was rewritten the tail is
    // dropped whole rather than read on its own terms. `new URL()` leaves the
    // brackets literal in a fragment.
    ['https://example.com/#password=prefix?fakesecret', 'https://example.com/#password=%5Bredacted%5D?[redacted]'],
    ['https://example.com/#password=prefix?token=x&page=1', 'https://example.com/#password=%5Bredacted%5D?[redacted]'],
    // The PostHog-token pass already replaced this value, so nothing *changed* in
    // the head — but the field is still a credential's, so the tail fails closed
    // all the same. The head keeps its literal brackets, being untouched.
    [
      'https://example.com/#password=phx_EXAMPLEONLYFAKEVALUE00000000000?private-suffix',
      'https://example.com/#password=[redacted]?[redacted]',
    ],
    // An empty tail has nothing to hide, so it stays empty rather than becoming a
    // second `[redacted]`.
    ['https://example.com/#password=fakepass?', 'https://example.com/#password=%5Bredacted%5D?'],
    // Dropping the tail counts as rewriting the trailing field, so the sentence's
    // comma goes with it — it could equally have been part of the credential.
    [
      'See https://example.com/#password=fakepass?rest, then retry.',
      'See https://example.com/#password=%5Bredacted%5D?[redacted] then retry.',
    ],
    // The head holds an `=` and is read as fields (`/docs/id` = `1`, benign); the
    // tail is its own field list. Reading the whole fragment as one would make it
    // a single key named `/docs/id` with the token buried in its value.
    ['https://example.com/#/docs/id=1?token=fakesecret', 'https://example.com/#/docs/id=1?token=%5Bredacted%5D'],
    // Neither part of a fragment is assumed to be a route: each side of the first
    // `?` is read as fields when it holds an `=` and as text otherwise. Here the
    // head is a field list whose `next` value happens to contain a `/` and the
    // tail is a field list of its own, so only the head is re-serialized.
    [
      'https://example.com/#access_token=fakesecret&next=https://other.test/?page=1',
      'https://example.com/#access_token=%5Bredacted%5D&next=https%3A%2F%2Fother.test%2F?page=1',
    ],
    [
      'https://example.com/#/token=fakesecret&next=https://other.test/?page=1',
      'https://example.com/#%2Ftoken=%5Bredacted%5D&next=https%3A%2F%2Fother.test%2F?page=1',
    ],
    [
      'https://example.com/x?jwt=fakejwt&sessionid=fakesession&code=fakecode&country_code=BR',
      'https://example.com/x?jwt=%5Bredacted%5D&sessionid=%5Bredacted%5D&code=%5Bredacted%5D&country_code=BR',
    ],
    [
      'https://gitlab.example.com/api?private_token=fakesecret&oauth_signature=fakesignature&id_token=fakeaccess&subscription-key=fakekey&sort_key=name',
      'https://gitlab.example.com/api?private_token=%5Bredacted%5D&oauth_signature=%5Bredacted%5D&id_token=%5Bredacted%5D&subscription-key=%5Bredacted%5D&sort_key=%5Bredacted%5D',
    ],
    // The punctuation split off the end goes with a rewritten trailing
    // credential rather than back onto the prose: it may be the credential's own
    // tail (`?password=fakepass!!!`), and there is no way to tell from here.
    [
      'See https://example.com/x?sig=fakesignature, then retry.',
      'See https://example.com/x?sig=%5Bredacted%5D then retry.',
    ],
    ['Failed (https://example.com/x?sig=fakesignature).', 'Failed (https://example.com/x?sig=%5Bredacted%5D'],
    [
      'See https://example.com/x?password=fakepass!, then retry.',
      'See https://example.com/x?password=%5Bredacted%5D then retry.',
    ],
    // The rewritten field is not the last one, so the comma is the prose's.
    [
      'See https://example.com/x?sig=fakesignature&page=2, then retry.',
      'See https://example.com/x?sig=%5Bredacted%5D&page=2, then retry.',
    ],
    // The URL's trailing part is a prose fragment, which is never rewritten.
    [
      'See https://example.com/x?sig=fakesignature#intro, then retry.',
      'See https://example.com/x?sig=%5Bredacted%5D#intro, then retry.',
    ],
    // A match that is the whole string is an address, not prose, so nothing is
    // split off its end and the `!!!` is read as part of the credential.
    ['https://example.com/login?password=fakepass!!!', 'https://example.com/login?password=%5Bredacted%5D'],
    [
      'https://fakeuser:fakepass@en.wikipedia.org/wiki/Foo_(bar).',
      'https://%5Bredacted%5D@en.wikipedia.org/wiki/Foo_(bar).',
    ],
    // `'` is a valid URI sub-delimiter: excluding it from the pattern's terminal
    // class truncated the match at the path and shipped the secret in the clear.
    // `new URL()` leaves it unencoded in a path, so the rewritten URL keeps it.
    ["https://example.com/o'reilly?token=fakesecret", "https://example.com/o'reilly?token=%5Bredacted%5D"],
    ["https://fakeuser:fake'pass@example.com/doc", 'https://%5Bredacted%5D@example.com/doc'],
    // A URL single-quoted in prose still gets its closing quote split off and
    // re-appended, the way a trailing comma or period is.
    ["Read 'https://example.com/x?sig=fakesignature' first.", "Read 'https://example.com/x?sig=%5Bredacted%5D first."],
    // A retained value that is itself a URL is sanitized one level deep, then
    // re-serialized by `URLSearchParams` — hence the double-encoded `%255B`.
    [
      'https://gateway.example.com/fetch?url=https://svc:fakepass@internal.example.com/doc%3Ftoken%3Dfakesecret',
      'https://gateway.example.com/fetch?url=https%3A%2F%2F%255Bredacted%255D%40internal.example.com%2Fdoc%3Ftoken%3D%255Bredacted%255D',
    ],
    // One level is the budget: the second gateway hop's value is dropped whole
    // rather than trusted, so the innermost token cannot survive.
    [
      'https://gateway.example.com/fetch?url=https%3A%2F%2Fgateway2.example.com%2Ffetch%3Furl%3Dhttps%253A%252F%252Finternal.test%252Fdoc%253Ftoken%253Dfakesecret',
      'https://gateway.example.com/fetch?url=https%3A%2F%2Fgateway2.example.com%2Ffetch%3Furl%3D%255Bredacted%255D',
    ],
    // PostHog tokens are redacted before URLs are rewritten: rewriting first
    // percent-encodes the `/` in front of the token and erases the `\b` boundary
    // its pattern needs. An already-redacted value is not a change, so a field
    // the token pass handled keeps the encoding it arrived with.
    [
      'https://example.com/?ref=/phx_EXAMPLEONLYFAKEVALUE00000000000&token=fakesecret',
      'https://example.com/?ref=%2F%5Bredacted%5D&token=%5Bredacted%5D',
    ],
    [
      'https://example.com/guide?token=phx_EXAMPLEONLYFAKEVALUE00000000000',
      'https://example.com/guide?token=[redacted]',
    ],
    // An MCP resource URI often has no authority, so requiring `//` let these
    // through untouched. `new URL()` gives `file:` its empty authority back.
    ['resource:guide?token=fakesecret', 'resource:guide?token=%5Bredacted%5D'],
    ['file:/guide.md?token=fakesecret', 'file:///guide.md?token=%5Bredacted%5D'],
    // One match can hold two addresses — a prose word in front of one, or two run
    // together — and the second's userinfo would otherwise sit in what parses as
    // the first one's path. The match is split where the second address begins.
    ['Failed URL:https://fakeuser:fakepass@example.com/doc', 'Failed URL:https://%5Bredacted%5D@example.com/doc'],
    ['URL:https://example.com/x?token=fakesecret', 'URL:https://example.com/x?token=%5Bredacted%5D'],
    ['a:b:https://fakeuser:fakepass@example.com/doc', 'a:b:https://%5Bredacted%5D@example.com/doc'],
    [
      'https://example.com/doc,https://fakeuser:fakepass@other.example.com/doc',
      'https://example.com/doc,https://%5Bredacted%5D@other.example.com/doc',
    ],
    // Two markdown links running together put the second address inside the
    // first one's fragment, which has no `=` and so is not a field list — but it
    // is still text, and text gets the URL pass.
    [
      '[a](https://public.test/#intro)[b](https://user:password@private.test/doc)',
      '[a](https://public.test/#intro)[b](https://%5Bredacted%5D@private.test/doc)',
    ],
    // An address parked in another's query is cut out too: `URLSearchParams`
    // would otherwise absorb it into a field KEY, and keys are never sanitized.
    [
      '[a](https://public.test/?download)[b](https://alice:fakepass@private.test/doc)',
      '[a](https://public.test/?download)[b](https://%5Bredacted%5D@private.test/doc)',
    ],
    // Value position is decided by reading back to the nearest structural
    // character. An `=` means a field name came first, so the address is part of
    // that field's value and goes through the nested pass with it — cutting it
    // out would leave the tail of the value stranded outside the redaction.
    [
      'https://example.com/?q=see,https://fakeuser:fakepass@x.test/doc',
      'https://example.com/?q=see%2Chttps%3A%2F%2F%255Bredacted%255D%40x.test%2Fdoc',
    ],
    ['https://host/x?token=foo%20https://secret.test/private', 'https://host/x?token=%5Bredacted%5D'],
    // A URL has one query delimiter, one fragment delimiter, and one between the
    // fragment's head and tail. Any other `?` is text inside a value, so the
    // second one here belongs to the token rather than opening a new field.
    ['https://example.com/?token=prefix?https://secret.example/private', 'https://example.com/?token=%5Bredacted%5D'],
    // The fragment's own delimiter still counts, so this address is adjacent.
    [
      'https://example.com/?a=1#b?https://fakeuser:fakepass@x.test/doc',
      'https://example.com/?a=1#b?https://%5Bredacted%5D@x.test/doc',
    ],
    // Value position exists only inside the fields. Before the first `?`/`#` an
    // `=` is a path character, so these two are adjacent addresses, not fields.
    ['https://host/a=b/c,https://fakeuser:fakepass@x.test/doc', 'https://host/a=b/c,https://%5Bredacted%5D@x.test/doc'],
    [
      'https://example.com/redirect=https://user:fakepass@private.example.com/doc',
      'https://example.com/redirect=https://%5Bredacted%5D@private.example.com/doc',
    ],
    [
      'https://example.com/?https://fakeuser:fakepass@x.test/doc',
      'https://example.com/?https://%5Bredacted%5D@x.test/doc',
    ],
    // The text in front of a fragment's fields is text too, so a whole address
    // parked there is sanitized rather than preserved as a route.
    [
      'https://public.test/#https://fakeuser:fakepass@private.test/doc?page=1',
      'https://public.test/#https://%5Bredacted%5D@private.test/doc?page=1',
    ],
    [
      '[a](https://public.test/#intro)[b](https://fakeuser:fakepass@private.test/doc?page=1)',
      '[a](https://public.test/#intro)[b](https://%5Bredacted%5D@private.test/doc?page=1)',
    ],
    // The closing paren goes with the redacted trailing field, by the same rule
    // that drops a sentence's comma after one — it could be the credential's own
    // tail, and nothing here can tell markdown from prose.
    [
      '[a](https://example.com/a)[b](https://example.com/b?token=fakesecret)',
      '[a](https://example.com/a)[b](https://example.com/b?token=%5Bredacted%5D',
    ],
    // An authority *after* the value's own `?`/`#` is field data, not a second
    // address: these are outer URIs carrying a URL, and parsing them whole is
    // what redacts their own credential.
    [
      'file:/guide?password=fakepass&url=https://example.com',
      'file:///guide?password=%5Bredacted%5D&url=https%3A%2F%2Fexample.com',
    ],
    ['resource:g?token=fakesecret+https://fakeuser:fakepass@b', 'resource:g?token=%5Bredacted%5D'],
    // No authority anywhere, so the whole run is one opaque-path URI.
    ['see:resource:guide?token=fakesecret', 'see:resource:guide?token=%5Bredacted%5D'],
    // Past the length bound too: it only caps a match with an authority.
    [`resource:${'a'.repeat(9_000)}?token=fakesecret`, `resource:${'a'.repeat(9_000)}?token=%5Bredacted%5D`],
  ])('sanitizes %s', (value, expected) => {
    expect(sanitizeCapturedValue(value)).toBe(expected)
    expect(sanitizeCapturedValue(expected)).toBe(expected)
  })

  it.each([
    ['a fragment that is prose rather than fields', 'https://example.com/doc#section-2'],
    ['a sentence whose URL carries no credentials', 'Failed (https://example.com/x?a=b).'],
    ['a path ending in balanced parentheses', 'https://en.wikipedia.org/wiki/Foo_(bar)'],
    ['a local file URL', 'file:///guide.md'],
    ['a `;`-separated value with no sensitive piece', 'https://example.com/x?a=1;b=2'],
    ['a path containing an apostrophe', "https://example.com/o'reilly"],
    ['a whole-string URL whose trailing `.` is part of the path', 'https://example.com/x?a=b.'],
    // Matching an optional authority sweeps up prose. That costs nothing: a
    // match with nothing to redact comes back byte-for-byte.
    ['a scheme-shaped word in a sentence', 'Error: see resource:guide.'],
    ['a time that follows a word without a space', 'Meet at12:30 today'],
    ['an authority-less URI with no query', 'resource:guide'],
    ['a Windows path', 'C:\\Users\\bob\\file.txt'],
    ['a log line with a level prefix and a timestamp', 'ERROR:root:started 2026-09-10T13:40:25.574Z'],
    ['a prose word joined to a URL with no credentials', 'Note:https://example.com/doc'],
    ['an app route in the fragment with a benign query', 'https://example.com/#/docs?page=2'],
    ['an app route in the fragment with no query at all', 'https://example.com/#/callback'],
    ['a fragment field list whose key and value are both benign', 'https://example.com/#/docs/id=1'],
    [
      'markdown links running together with no credentials',
      '[a](https://public.test/#intro)[b](https://private.test/doc)',
    ],
    // The length bound caps authority-bearing addresses only, so a long
    // authority-less match is still parsed — and a data URI holds nothing to
    // redact, so it comes back byte-for-byte instead of being dropped.
    ['a data URI past the length bound', `data:application/octet-stream;base64,${'AAAA%ZZ'.repeat(1_500)}`],
  ])('leaves %s byte-for-byte', (_label, value) => {
    expect(sanitizeCapturedValue(value)).toBe(value)
  })

  it.each([
    // A fragment is itself a URL whose fragment is itself a URL: descending
    // would recurse once per `#`. Depth is capped at two, so the third level is
    // dropped whole.
    ['a fragment nested once per `#`', `${'resource:x#'.repeat(5_900)}intro`, 'resource:x#resource:x#[redacted]'],
    // Fields opened once, then thousands of addresses: deciding value position by
    // scanning backwards made every one of them walk to the same `?`.
    [
      'addresses run together after a query opens',
      `https://a.test/?${'https://b.test/x,'.repeat(3_800)}`,
      `https://a.test/?${'https://b.test/x,'.repeat(3_800)}`,
    ],
    // Addresses run together: one pass over every piece, not one frame each.
    [
      'addresses run together without whitespace',
      `${'https://a.test/x,'.repeat(3_800)}https://fakeuser:fakepass@b.test/doc`,
      `${'https://a.test/x,'.repeat(3_800)}https://%5Bredacted%5D@b.test/doc`,
    ],
  ])('sanitizes %s in one pass over the value', (_label, value, expected) => {
    const start = Date.now()
    expect(sanitizeCapturedValue(value)).toBe(expected)
    // Coverage and concurrent monorepo tests can push this stress case past one second in CI.
    expect(Date.now() - start).toBeLessThan(5000)
  })

  it('splits trailing punctuation off long punctuation runs quickly', () => {
    // The worst case for a `$`-anchored trailing-punctuation pattern: a long run
    // that does *not* end the match, so every start position backtracks through
    // it — ~40ms per URL, and a captured string can hold many. Each URL here
    // stays under `MAX_URL_LENGTH` so the length bound does not short-circuit it.
    const pathological = Array(50).fill(`https://example.com/${'.'.repeat(8_000)}a`)
    const start = Date.now()
    expect(sanitizeCapturedValue(pathological)).toEqual(pathological)
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it('skips authority searches for a large image inlined in HTML', () => {
    // An HTML email embeds its images as `data:` URIs, one URL-shaped match as
    // long as the image, so it cannot be cut out of the scanned head.
    const html = `<p>Hi</p><img src="data:image/png;base64,${'iVBORw0KGgo'.repeat(1_000_000)}" alt="logo"/>`
    const authoritySearch = vi.spyOn(String.prototype, 'matchAll')
    try {
      expect(sanitizeCapturedValue(html)).toBe('<p>Hi</p><img src="[redacted]...')
      expect(authoritySearch).not.toHaveBeenCalled()
    } finally {
      authoritySearch.mockRestore()
    }
  })
})

describe('redactPii', () => {
  const NBSP = String.fromCharCode(0x00a0)
  const NNBSP = String.fromCharCode(0x202f)

  it.each([
    [
      'an email address',
      'Looking up orders for jane.doe@acme.co.uk before refunding.',
      'Looking up orders for [redacted] before refunding.',
    ],
    ['an email with a maximal 64-char local part', `from ${'a'.repeat(64)}@example.com now`, 'from [redacted] now'],
    ['an email with an accented local part', 'Writing to josé@example.com now.', 'Writing to [redacted] now.'],
    [
      'an IPv4 address',
      'Blocking traffic from 203.0.113.42 after abuse.',
      'Blocking traffic from [redacted] after abuse.',
    ],
    [
      'an IPv6 address with a middle ::',
      'Tracing request from 2001:db8::ff00:42:8329 across the mesh.',
      'Tracing request from [redacted] across the mesh.',
    ],
    ['an IPv6 address ending in ::', 'Routing host 2001:db8:: for now.', 'Routing host [redacted] for now.'],
    ['an IPv6 loopback ::1', 'Health check from ::1 passed.', 'Health check from [redacted] passed.'],
    [
      'a NANP phone with dashes',
      'Reference ticket for number 415-555-0142 escalation.',
      'Reference ticket for number [redacted] escalation.',
    ],
    ['a NANP phone with slashes', 'Call the customer on 415/555/0142 today.', 'Call the customer on [redacted] today.'],
    [
      'a NANP phone with parens and +1',
      'Calling back on +1 (415) 555-0142 about the outage.',
      'Calling back on [redacted] about the outage.',
    ],
    [
      'a NANP phone with a parenthesized area code and no following separator',
      'Reaching them at (415)555-0142 today.',
      'Reaching them at [redacted] today.',
    ],
    ['an international phone with a + country code', 'Ring +44 (0) 20 7946 0958 please.', 'Ring [redacted] please.'],
    [
      'a phone grouped with NBSP spaces',
      `Calling the customer on 415${NNBSP}555${NNBSP}0132 today.`,
      'Calling the customer on [redacted] today.',
    ],
    [
      'a Luhn-valid card with spaces',
      'Charging the saved card 4111 1111 1111 1111 for the renewal.',
      'Charging the saved card [redacted] for the renewal.',
    ],
    ['a card grouped with dots', 'Charging card 4111.1111.1111.1111 today.', 'Charging card [redacted] today.'],
    ['a card grouped with slashes', 'Charging card 4111/1111/1111/1111 today.', 'Charging card [redacted] today.'],
    [
      'a card grouped with NBSP spaces',
      `Charging card 4111${NBSP}1111${NBSP}1111${NBSP}1111 now.`,
      'Charging card [redacted] now.',
    ],
    [
      'a card without absorbing an adjacent expiry field',
      'Charging card 4111 1111 1111 1111 12/30 for renewal.',
      'Charging card [redacted] 12/30 for renewal.',
    ],
    [
      'every card when two appear in one span',
      'Moving funds 4111 1111 1111 1111 5555 5555 5555 4444 now.',
      'Moving funds [redacted] [redacted] now.',
    ],
    ['a card followed by an SSN', 'Card 4111111111111111 078-05-1120 on file.', 'Card [redacted] [redacted] on file.'],
    ['a card grouped 4-6-5', 'Charging card 3782 822463 10005 today.', 'Charging card [redacted] today.'],
    ['an SSN with dashes', 'Verifying SSN 123-45-6789 for the claim.', 'Verifying SSN [redacted] for the claim.'],
    ['an SSN with spaces', 'Verifying SSN 123 45 6789 for the claim.', 'Verifying SSN [redacted] for the claim.'],
    ['an SSN with dots', 'Verifying SSN 123.45.6789 for the claim.', 'Verifying SSN [redacted] for the claim.'],
  ])('redacts %s', (_label, input, expected) => {
    expect(redactPii(input)).toBe(expected)
  })

  it.each([
    ['a bare numeric identifier without grouping', 'Fetching record 4155550142 from the ledger service.'],
    ['a bare 9-digit number that is not an SSN', 'Looking up record 123456789 in the ledger.'],
    ['a Luhn-invalid long digit run', 'Correlating with order 1234567890123456 in the warehouse.'],
    ['a date and time that resembles a phone number', 'Deploying at 2024-01-15 12:30 UTC after review.'],
    ['a dotted version/build number', 'Upgrading to build 2024.11.05.1830 for the team.'],
    ['a C++ scope expression that resembles IPv6', 'Calling std::bad and std::vector helpers for the team.'],
    [
      'ordinary prose with versions, dates, and code separators',
      'Upgrading to v1.2.3 on 2024-01-15 by refactoring std::vector usage.',
    ],
    ['prose with no personal data', 'Searching the organization repositories to prioritize open performance issues.'],
  ])('leaves %s untouched', (_label, input) => {
    expect(redactPii(input)).toBe(input)
  })

  it('redacts multiple identifiers in one string', () => {
    expect(redactPii('Emailing bob@example.com and calling +1-202-555-0170 about the issue.')).toBe(
      'Emailing [redacted] and calling [redacted] about the issue.'
    )
  })

  it('handles a long pathological string quickly (email pattern is not quadratic)', () => {
    // A 100k-char run with an `@` but no valid TLD is the worst case for an
    // unbounded email pattern. With bounded quantifiers this stays linear; a
    // regression to `+` would blow the default test timeout instead.
    const pathological = `${'a'.repeat(50_000)}@${'a'.repeat(50_000)}`
    const start = Date.now()
    expect(redactPii(pathological)).toBe(pathological)
    expect(Date.now() - start).toBeLessThan(1000)
  })
})

describe('redactPayloadPii', () => {
  it.each([
    ['an email address', 'Customer ada@example.com', 'Customer [redacted]'],
    ['an email address with an accented local part', 'Customer josé@example.com', 'Customer [redacted]'],
    ['a public IPv4 after a space', 'last seen from 203.0.113.7', 'last seen from [redacted]'],
    ['a public IPv4 after a colon', 'client ip:203.0.113.7', 'client ip:[redacted]'],
    ['a public IPv4 after an @', 'user@203.0.113.7', 'user@[redacted]'],
    ['a public IPv4 in a URL', 'http://203.0.113.7/', 'http://[redacted]/'],
    ['a public IPv4 just outside 172.16.0.0/12', 'peer 172.32.0.1', 'peer [redacted]'],
    ['a four-part version after a colon, which reads like an address', 'node:22.11.0.3', 'node:[redacted]'],
    ['an IPv6 address', 'from 2001:db8::ff00:42:8329 now', 'from [redacted] now'],
    ['a phone with + and a country code', 'support +1 415 555 0142', 'support [redacted]'],
    ['a phone with the 00 prefix', 'call 0044 20 7946 0958 today', 'call [redacted] today'],
    ['a phone with the 011 prefix', 'call 011 44 20 7946 0958 today', 'call [redacted] today'],
    ['a phone with a parenthesized area code', 'call (415) 555-0142 today', 'call [redacted] today'],
    ['a phone with +1 and a parenthesized area code', 'call +1 (415) 555-0142 today', 'call [redacted] today'],
    ['a Luhn-valid card', 'card 4111 1111 1111 1111 on file', 'card [redacted] on file'],
    ['a US SSN', 'SSN 123-45-6789', 'SSN [redacted]'],
    ['a card followed by an SSN', 'card 4111111111111111 078-05-1120', 'card [redacted] [redacted]'],
    [
      'a card written as a JSON number, quoted',
      '{"card":4111111111111111,"count":3}',
      '{"card":"[redacted]","count":3}',
    ],
    ['a card in a JSON array, quoted', '[ 4111111111111111 ]', '[ "[redacted]" ]'],
    ['a card inside a JSON string, unquoted', '{"note":"4111111111111111"}', '{"note":"[redacted]"}'],
  ])('redacts %s', (_label, input, expected) => {
    expect(redactPayloadPii(input)).toBe(expected)
  })

  it.each([
    ['a US phone without a prefix or parentheses', 'Order 415-555-0142'],
    ['a version after a letter', 'built with v22.11.0.3'],
    ['a five-part version', 'release 1.2.3.4.5'],
    ['an address followed by a digit-led field', 'release 203.0.113.7.4'],
    ['a public IPv4 directly after a letter', 'IP203.0.113.7'],
    ['a loopback address with a port', 'db at 127.0.0.1:5432'],
    ['a 10/8 address', 'host 10.20.30.40'],
    ['a 172.16/12 address', 'host 172.31.255.1'],
    ['a 192.168/16 address', 'host 192.168.1.10'],
    ['a link-local address', 'metadata 169.254.169.254'],
    ['the unspecified address', 'bind 0.0.0.0'],
    ['a Luhn-invalid long digit run', 'order 1234567890123456'],
    ['a date and time', 'at 2024-01-15 12:30 UTC'],
    ['a float whose fraction passes the card checksum', '{"v":710.4032039642334}'],
    ['a fraction of 16 digits', '[0.4111111111111111]'],
    ['a negative card-shaped number', '[-4111111111111111]'],
    ['a card-shaped number with a fraction', '[4111111111111111.5]'],
    ['a card grouped with dots', 'ref 4111.1111.1111.1111'],
    ['a negative card-shaped JSON member', '{"n":-4111111111111111}'],
    ['a fraction starting 011', '[620.0119256973267]'],
    ['a fraction starting 00', '[0.0012345678901]'],
    ['two dates', '2024-08-12 2022-03-03'],
    ['two dates whose tail passes the card checksum', '2027-03-14 2020-08-20'],
    ['two US phone-shaped numbers', '385-353-6556 200-426-7992'],
    ['two US phone-shaped numbers, the first passing the checksum', '813-545-4304 607-403-3631'],
    ['a US phone-shaped number ending in a zero-padded group', '874-426-0063 247-900-7184'],
    ['six-digit ids', '769677 908755 886773'],
    ['ZIP+4 codes', '98432-1669 62609-6852'],
  ])('keeps %s', (_label, input) => {
    expect(redactPayloadPii(input)).toBe(input)
  })

  describe('ordinary number lists', () => {
    let seed = 99
    const random = (low: number, high: number): number =>
      low + Math.floor(((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * (high - low + 1))
    const pad = (value: number, length: number): string => String(value).padStart(length, '0')
    const date = (): string => `${random(2015, 2027)}-${pad(random(1, 12), 2)}-${pad(random(1, 28), 2)}`
    const phone = (): string => `${random(200, 999)}-${random(200, 999)}-${pad(random(0, 9999), 4)}`

    it.each([
      ['date pairs', () => `${date()} ${date()}`],
      ['US phone-shaped pairs', () => `${phone()} ${phone()}`],
      ['six-digit id lists', () => `${random(100000, 999999)} ${random(100000, 999999)} ${random(100000, 999999)}`],
      [
        'ZIP+4 lists',
        () => `${random(10000, 99999)}-${random(1000, 9999)} ${random(10000, 99999)}-${random(1000, 9999)}`,
      ],
    ])('keeps every one of 2000 %s', (_label, generate) => {
      const lists = Array.from({ length: 2000 }, generate)

      expect(lists.filter((list) => redactPayloadPii(list) !== list)).toEqual([])
    })
  })

  it.each([
    ['a US phone without a prefix', 'Order 415-555-0142'],
    ['a loopback address', 'db at 127.0.0.1'],
  ])('leaves the intent pass redacting %s', (_label, input) => {
    expect(redactPii(input)).not.toBe(input)
  })
})

describe('card numbers', () => {
  it.each([
    ['grouped 4-4-4-3', 'amex 3782 8224 6310 005', 'amex [redacted]', 'amex 3782 8224 6310 005'],
    ['grouped 4-4-5', 'visa 4222 2222 22222', 'visa [redacted]', 'visa 4222 2222 22222'],
    ['grouped 4-4-4-1', 'visa 4222 2222 2222 2', 'visa [redacted]', 'visa 4222 2222 2222 2'],
    ['grouped 5-5-5-1', 'pan 41111 11111 11111 1', 'pan [redacted]', 'pan 41111 11111 11111 1'],
    ['grouped in pairs', 'pan 41 11 11 11 11 11 11 11', 'pan [redacted]', 'pan 41 11 11 11 11 11 11 11'],
    ['grouped 4-4-4-4-3', 'pan 6212 3456 7890 1234 569', 'pan [redacted]', 'pan [redacted]'],
    ['grouped 4-6-5', 'amex 3782 822463 10005', 'amex [redacted]', 'amex [redacted]'],
    ['grouped 4-6-4', 'diners 3056 930902 5904', 'diners [redacted]', 'diners [redacted]'],
    [
      'grouped 4-4-4-4 after a leading group',
      'ref 1234 4111 1111 1111 1111',
      'ref 1234 [redacted]',
      'ref 1234 [redacted]',
    ],
    [
      'grouped 4-4-4-4 and followed by an SSN',
      'card 4111 1111 1111 1111 078-05-1120',
      'card [redacted] [redacted]',
      'card [redacted] [redacted]',
    ],
    ['glued to a word by a dash', 'card-4111111111111111', 'card-[redacted]', 'card-[redacted]'],
    ['glued to a word by a dot', 'No.4111111111111111', 'No.[redacted]', 'No.[redacted]'],
    ['grouped by dashes and glued by one', 'ref-4111-1111-1111-1111', 'ref-[redacted]', 'ref-[redacted]'],
    [
      'followed by an SSN',
      'card 4111111111111111 078-05-1120',
      'card [redacted] [redacted]',
      'card [redacted] [redacted]',
    ],
    [
      'grouped by mixed separators with a dot',
      'card 4111-1111 1111.1111 ok',
      'card [redacted] ok',
      'card 4111-1111 1111.1111 ok',
    ],
    ['grouped by slashes', 'card 4111/1111/1111/1111', 'card [redacted]', 'card 4111/1111/1111/1111'],
    ['with a fraction', 'cards 4111111111111111.1 x', 'cards [redacted].1 x', 'cards 4111111111111111.1 x'],
  ])('%s: %s', (_label, input, intent, payload) => {
    expect(redactPii(input)).toBe(intent)
    expect(redactPayloadPii(input)).toBe(payload)
  })

  it.each([
    ['escaped line breaks', '{"pan":"4111\\n1111\\n1111\\n1111"}'],
    ['line breaks', '4111\n1111\n1111\n1111'],
    ['an escaped line break inside a phone number', '{"phone":"+44\\n20 7946 0958"}'],
  ])('does not join digit groups across %s', (_label, input) => {
    expect(redactPii(input)).toBe(input)
    expect(redactPayloadPii(input)).toBe(input)
  })
})

describe('JSON text', () => {
  const passes = [
    ['payload', (value: unknown): unknown => sanitizeCapturedValue(value, { redactPayloadPersonalData: true })],
    ['intent', sanitizeFreeTextValue],
  ] as const
  const identifiers = [
    ['an email', 'ada@example.com'],
    ['a card', '4111111111111111'],
    ['an SSN', '078-05-1120'],
    ['a public IPv4', '203.0.113.7'],
    ['an IPv6', '2001:db8::7334'],
    ['a phone', '+1 415 555 0142'],
    ['a PostHog token', 'phc_123456789012345678901234567890'],
  ] as const
  const escapes = ['\\n', '\\t', '\\r', '\\b', '\\f', '\\/', '\\\\', '\\"', '\\u00e9']
  const containers = [
    ['plain', (json: string) => json],
    ['embedded in prose', (json: string) => `Result: ${json}`],
    ['NDJSON', (json: string) => `{"a":1}\n${json}`],
    ['after a BOM', (json: string) => `\uFEFF${json}`],
  ] as const
  const member = (escape: string, value: string): string => `{"note":"x${escape}${value}","x${escape}${value}":1}`

  describe.each(passes)('through the %s pass', (_pass, sanitize) => {
    it.each(
      identifiers.flatMap(([label, identifier]) =>
        escapes
          // An escaped letter reads as part of the address after it; see the escaped characters below.
          .filter((escape) => !(label === 'an email' && escape === '\\u00e9'))
          .flatMap((escape) => containers.map(([name, wrap]) => [label, escape, name, identifier, wrap] as const))
      )
    )('redacts %s after %s, %s, in place', (_label, escape, _container, identifier, wrap) => {
      expect(sanitize(wrap(member(escape, identifier)))).toBe(wrap(member(escape, '[redacted]')))
    })

    it.each([
      ['an address with an escaped @', '{"e":"ada\\u0040example.com"}', '{"e":"[redacted]"}'],
      ['an address with an escaped dot', '{"e":"ada@example\\u002ecom"}', '{"e":"[redacted]"}'],
      ['an address with an escaped last letter', '{"e":"ada@example.co\\u006d"}', '{"e":"[redacted]"}'],
      ['an address with an escaped accented letter', '{"e":"jos\\u00e9@example.com"}', '{"e":"[redacted]"}'],
      ['an address after an escaped letter, with it', '{"e":"x\\u00e9ada@example.com"}', '{"e":"[redacted]"}'],
      ['an address after an escaped line break', '{"e":"x\\u000aada@example.com"}', '{"e":"x\\u000a[redacted]"}'],
      ['a card grouped by escaped spaces', '{"c":"4111\\u00201111\\u00201111\\u00201111"}', '{"c":"[redacted]"}'],
      ['a card grouped by escaped NNBSP', '{"c":"4111\\u202f1111\\u202f1111\\u202f1111"}', '{"c":"[redacted]"}'],
      ['a card grouped by escaped dashes', '{"c":"4111\\u002d1111\\u002d1111\\u002d1111"}', '{"c":"[redacted]"}'],
      ['a card before an escaped letter', '{"c":"4111111111111111\\u00e9"}', '{"c":"[redacted]\\u00e9"}'],
      ['an SSN grouped by escaped dashes', '{"s":"078\\u002d05\\u002d1120"}', '{"s":"[redacted]"}'],
      ['a phone grouped by escaped spaces', '{"p":"+1\\u0020415\\u0020555\\u00200142"}', '{"p":"[redacted]"}'],
      ['a phone grouped by an escaped NBSP', '{"p":"+44\\u00a020 7946 0958"}', '{"p":"[redacted]"}'],
      ['a public IPv4 with an escaped dot', '{"i":"203.0.113\\u002e7"}', '{"i":"[redacted]"}'],
      ['a PostHog token with an escaped letter', '{"t":"phc_\\u0061bcdefghijklmnopqrstuvwxyz"}', '{"t":"[redacted]"}'],
      ['a card after an escaped quote', '{"a":"\\u0022","n":4111111111111111}', '{"a":"\\u0022","n":"[redacted]"}'],
    ])('redacts %s, keeping the JSON valid', (_label, text, expected) => {
      const sanitized = sanitize(text) as string

      expect(sanitized).toBe(expected)
      expect(() => JSON.parse(sanitized)).not.toThrow()
    })

    it.each([
      ['a card with a zero fraction', '{"n":4111111111111111.0}'],
      ['a card with an exponent', '[4111111111111111e0]'],
      ['a card written with a fraction and an exponent', '[41111111111111110e-1]'],
      ['a 19-digit card with a zero fraction', '[6212345678901234569.00]'],
    ])('replaces %s written as a JSON number whole', (_label, text) => {
      const sanitized = sanitize(text) as string
      const parsed: unknown = JSON.parse(sanitized)

      expect(JSON.stringify(parsed)).not.toMatch(/\d{13}/)
      expect(sanitized).toContain('"[redacted]"')
    })

    it.each([2, 4, 10])('quotes a card nested 7 levels deep in JSON indented by %i', (indent) => {
      let value: unknown = [4111111111111111]
      for (let level = 0; level < 6; level++) {
        value = { level: value }
      }

      expect(JSON.parse(sanitize(JSON.stringify(value, null, indent)) as string)).toEqual(
        JSON.parse(JSON.stringify(value).replace('4111111111111111', '"[redacted]"'))
      )
    })

    it('reads a text that is only a card number as prose, leaving it unquoted', () => {
      expect(sanitize('4111111111111111')).toBe('[redacted]')
    })

    it.each(escapes.flatMap((escape) => containers.map(([name, wrap]) => [escape, name, wrap] as const)))(
      'keeps text with %s and nothing to redact byte for byte, %s',
      (escape, _container, wrap) => {
        const text = wrap(`{"note":"x${escape}y 12.5${escape}4111","x${escape}":[-1.5e3]}`)

        expect(sanitize(text)).toBe(text)
      }
    )

    it.each([
      ['duplicate keys', '{"email":"ada@example.com","email":null}', '{"email":"[redacted]","email":null}'],
      ['a 17-digit card integer', '{"pan":62123456789012347}', '{"pan":"[redacted]"}'],
      ['a 19-digit card integer', '[6212345678901234569, 1]', '["[redacted]", 1]'],
      [
        'a __proto__ member',
        '{"__proto__":{"email":"ada@example.com"},"y":2}',
        '{"__proto__":{"email":"[redacted]"},"y":2}',
      ],
      ['a card between commas inside a string', '{"note":"a, 4111111111111111, b"}', '{"note":"a, [redacted], b"}'],
      [
        'pretty-printed JSON, keeping its formatting',
        JSON.stringify({ card: 4111111111111111, note: 'x\nada@example.com', count: 3 }, null, 2),
        JSON.stringify({ card: '[redacted]', note: 'x\n[redacted]', count: 3 }, null, 2),
      ],
      [
        'JSON nested deeper than any walk',
        `${'['.repeat(50_000)}"ada@example.com"${']'.repeat(50_000)}`,
        `${'['.repeat(50_000)}"[redacted]"${']'.repeat(50_000)}`,
      ],
    ])('redacts %s in place', (_label, text, expected) => {
      expect(sanitize(text)).toBe(expected)
    })

    it.each([
      ['a __proto__ member', '{"__proto__":{"x":1},"y":2}'],
      ['an integer above 2^53', '{"id":9007199254740993,"n":-0}'],
      ['pretty-printed JSON with nothing to redact', JSON.stringify({ id: 'ord_1', total: 12.5 }, null, 2)],
    ])('keeps %s byte for byte', (_label, text) => {
      expect(sanitize(text)).toBe(text)
    })
  })

  it.each([
    ['a float whose fraction passes the card checksum', '{"v":710.4032039642334}'],
    ['a fraction of 16 digits', '[0.4111111111111111]'],
    ['a negative card-shaped number', '[-4111111111111111]'],
    ['a negative card-shaped member', '{"n":-4111111111111111}'],
    ['a card-shaped number with a fraction', '[4111111111111111.5]'],
    ['a card-shaped number scaled to a fraction', '[4111111111111111e-3]'],
  ])('keeps %s byte for byte through the payload pass', (_label, text) => {
    expect(sanitizeCapturedValue(text, { redactPayloadPersonalData: true })).toBe(text)
  })

  it('replaces a negative card written as a JSON number whole through the intent pass', () => {
    expect(sanitizeFreeTextValue('{"a":-4111111111111111}')).toBe('{"a":"[redacted]"}')
  })

  it.each(escapes)('redacts a PostHog token after %s with the payload option off', (escape) => {
    const text = member(escape, 'phc_123456789012345678901234567890')

    expect(sanitizeCapturedValue(text)).toBe(member(escape, '[redacted]'))
  })

  describe('random floats', () => {
    const sanitize = (value: unknown): unknown => sanitizeCapturedValue(value, { redactPayloadPersonalData: true })
    let seed = 42
    const random = (): number => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    const floats = Array.from({ length: 10_000 }, () => random() * 1000)

    it('keeps them in short JSON text copies', () => {
      const texts = floats.slice(0, 1000).map((v) => JSON.stringify({ v }))

      expect(texts.filter((text) => sanitize(text) !== text)).toEqual([])
    })

    it('keeps them in a JSON text copy longer than the scanned window', () => {
      const text = JSON.stringify(floats)

      expect(sanitize(text)).toBe(`${text.slice(0, 131_072)}...`)
    })
  })
})

const presignedUrlLine = `https://bucket.s3.amazonaws.com/a.pdf?X-Amz-Security-Token=${'Z'.repeat(883)}&X-Amz-Signature=${'a'.repeat(64)}\n`
const redactedPresignedUrlLine =
  'https://bucket.s3.amazonaws.com/a.pdf?X-Amz-Security-Token=%5Bredacted%5D&X-Amz-Signature=%5Bredacted%5D\n'

describe('sanitizing a multi-megabyte string', () => {
  const medianMilliseconds = (run: () => unknown): number => {
    const times = Array.from({ length: 5 }, () => {
      const start = performance.now()
      run()
      return performance.now() - start
    })
    return times.sort((a, b) => a - b)[2]
  }
  const sanitizers = [
    ['payload', (value: string) => sanitizeCapturedValue(value, { redactPayloadPersonalData: true })],
    ['payload option off', (value: string) => sanitizeCapturedValue(value)],
    ['intent', (value: string) => sanitizeFreeText(value)],
  ] as const
  const values = [
    ['digits joined by - and .', (length: number) => '1-1.'.repeat(length / 4)],
    ['comma-separated ids', (length: number) => '1000000,'.repeat(length / 8)],
    [
      'a URL whose userinfo and token sit past the window',
      (length: number) => `https:secretuser${'a'.repeat(length)}@localhost/?api_key=phc_123456789012345678901234567890`,
    ],
    [
      'pre-signed URL lines that redaction shrinks tenfold',
      (length: number) => presignedUrlLine.repeat(Math.ceil(length / presignedUrlLine.length)),
    ],
  ] as const

  it.each(
    sanitizers.flatMap(([name, sanitize]) => values.map(([label, value]) => [name, label, value, sanitize] as const))
  )('costs the %s pass on 8MB of %s about what it costs on 1MB', (_name, _label, value, sanitize) => {
    const small = value(1_000_000)
    const large = value(8_000_000)
    sanitize(small)

    expect(medianMilliseconds(() => sanitize(large)) / medianMilliseconds(() => sanitize(small))).toBeLessThan(3)
  })

  it.each([
    ['redactPii', redactPii],
    ['redactPayloadPii', redactPayloadPii],
    ['the intent pass', sanitizeFreeText],
  ] as const)('%s does not overflow the stack on 12MB of digits joined by - and .', (_name, redact) => {
    expect(() => redact('1-1.'.repeat(3_000_000))).not.toThrow()
  })
})

describe('sanitizing strings longer than truncation keeps', () => {
  const WINDOW = 131_072
  const token = 'phc_123456789012345678901234567890'
  const filler = (length: number): string => 'lorem ipsum '.repeat(Math.ceil(length / 12)).slice(0, length)

  it.each([
    ['plain text', filler(5_000_000), `${filler(WINDOW)}...`],
    ['a token cut at the window edge', filler(WINDOW - 32) + token, `${filler(WINDOW - 32)}[redacted]...`],
    [
      'a credential URL cut at the window edge',
      `${filler(WINDOW - 44)}https://example.com/?api_key=secretsecretsecretsecret more`,
      `${filler(WINDOW - 44)}[redacted]...`,
    ],
    [
      'an attachment',
      Buffer.alloc(3_000_000, 7).toString('base64'),
      '[binary data redacted - not supported by PostHog MCP analytics]',
    ],
    // Redacting shrinks these heads below the window, so the cut must move out until it is past what truncation keeps.
    [
      'tokens with one cut at the window edge',
      `${filler(12)}a. ${`${token} `.repeat(4_000)}and more`,
      `${filler(12)}a. ${'[redacted] '.repeat(4_000)}and more`,
    ],
    // A URL running past the window is replaced whole: its credentials and field count can sit beyond the cut.
    [
      'a URL whose credentials sit past the window',
      `${filler(996)}https:secretuser${'a'.repeat(WINDOW)}@localhost/path`,
      `${filler(996)}[redacted]...`,
    ],
    [
      'a URL opening the value whose userinfo and token sit past the window',
      `https:secretuser${'a'.repeat(WINDOW)}@localhost/path?api_key=${token}`,
      '[redacted]...',
    ],
    [
      'a URI whose field count passes the limit past the window',
      `${filler(996)}resource:private/${'p'.repeat(WINDOW)}?${'a=1&'.repeat(200)}`,
      `${filler(996)}[redacted]...`,
    ],
    [
      'pre-signed URLs',
      `https://bucket.s3.amazonaws.com/a.pdf?X-Amz-Security-Token=${'Z'.repeat(1_200)}&X-Amz-Signature=${'a'.repeat(64)}\n`.repeat(
        200
      ),
      `${'https://bucket.s3.amazonaws.com/a.pdf?X-Amz-Security-Token=%5Bredacted%5D&X-Amz-Signature=%5Bredacted%5D\n'.repeat(
        97
      )}[redacted]...`,
    ],
    // Redacting shrinks these tenfold, so even the largest window keeps less than twice what truncation keeps.
    [
      'pre-signed URL lines past the largest window',
      presignedUrlLine.repeat(1_000),
      `${redactedPresignedUrlLine.repeat(4 * 128).slice(0, -32_768)}...`,
    ],
  ])('scans only the window truncation can keep: %s', (_case, value, expected) => {
    expect(sanitizeCapturedValue(value)).toBe(expected)
    expect(sanitizeCapturedValue(value, { redactPayloadPersonalData: true })).toBe(expected)
    expect(sanitizeFreeTextValue(value)).toBe(expected)
  })

  it.each([
    ['payload', (value: string) => sanitizeCapturedValue(value, { redactPayloadPersonalData: true })],
    ['intent', (value: string) => sanitizeFreeTextValue(value)],
  ] as const)(
    'drops a match cut at the widest window edge when redaction shrinks the head below what truncation keeps: %s',
    (_name, sanitize) => {
      const tokenCount = Math.floor((4 * WINDOW - 12) / 305)
      const padding = ' '.repeat(4 * WINDOW - 12 - 305 * tokenCount)
      const value = `${`phc_${'a'.repeat(300)} `.repeat(tokenCount)}${padding}john.doe@example.com and more`

      expect(sanitize(value)).toBe('...')
    }
  )
})
