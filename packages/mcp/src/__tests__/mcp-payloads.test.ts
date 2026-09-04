import { buildCapturedMcpParameters, redactPii } from '../extensions/mcp-payloads'

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
