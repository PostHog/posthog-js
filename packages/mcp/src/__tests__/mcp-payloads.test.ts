import { buildCapturedMcpParameters, redactPii, sanitizeCapturedValue } from '../extensions/mcp-payloads'

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
    ['https://example.com/x?a=1;token=fakesecret', 'https://example.com/x?a=1&token=%5Bredacted%5D'],
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
  ])('sanitizes %s', (value, expected) => {
    expect(sanitizeCapturedValue(value)).toBe(expected)
    expect(sanitizeCapturedValue(expected)).toBe(expected)
  })

  it.each([
    ['a fragment that is prose rather than fields', 'https://example.com/doc#section-2'],
    ['a sentence whose URL carries no credentials', 'Failed (https://example.com/x?a=b).'],
    ['a path ending in balanced parentheses', 'https://en.wikipedia.org/wiki/Foo_(bar)'],
    ['a local file URL', 'file:///guide.md'],
    ['a `;`-separated query with no sensitive key', 'https://example.com/x?a=1;b=2'],
    ['a path containing an apostrophe', "https://example.com/o'reilly"],
    ['a whole-string URL whose trailing `.` is part of the path', 'https://example.com/x?a=b.'],
  ])('leaves %s byte-for-byte', (_label, value) => {
    expect(sanitizeCapturedValue(value)).toBe(value)
  })

  it('splits trailing punctuation off long punctuation runs quickly', () => {
    // The worst case for a `$`-anchored trailing-punctuation pattern: a long run
    // that does *not* end the match, so every start position backtracks through
    // it — ~40ms per URL, and a captured string can hold many. Each URL here
    // stays under `MAX_URL_LENGTH` so the length bound does not short-circuit it.
    const pathological = Array(50)
      .fill(`https://example.com/${'.'.repeat(8_000)}a`)
      .join(' ')
    const start = Date.now()
    expect(sanitizeCapturedValue(pathological)).toBe(pathological)
    expect(Date.now() - start).toBeLessThan(1000)
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
