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
  it('redacts email addresses', () => {
    expect(redactPii('Looking up orders for jane.doe@acme.co.uk before refunding.')).toBe(
      'Looking up orders for [redacted] before refunding.'
    )
  })

  it('redacts phone numbers with grouping characters', () => {
    expect(redactPii('Calling the customer back on +1 (415) 555-0142 about the outage.')).toBe(
      'Calling the customer back on [redacted] about the outage.'
    )
    expect(redactPii('Reference ticket for number 415-555-0142 escalation.')).toBe(
      'Reference ticket for number [redacted] escalation.'
    )
  })

  it('leaves bare numeric identifiers without grouping untouched', () => {
    expect(redactPii('Fetching record 4155550142 from the ledger service.')).toBe(
      'Fetching record 4155550142 from the ledger service.'
    )
  })

  it('redacts IPv4 addresses', () => {
    expect(redactPii('Blocking traffic from 203.0.113.42 after abuse reports.')).toBe(
      'Blocking traffic from [redacted] after abuse reports.'
    )
  })

  it('redacts IPv6 addresses', () => {
    expect(redactPii('Tracing request from 2001:db8::ff00:42:8329 across the mesh.')).toBe(
      'Tracing request from [redacted] across the mesh.'
    )
  })

  it('redacts Luhn-valid credit-card numbers', () => {
    expect(redactPii('Charging the saved card 4111 1111 1111 1111 for the renewal.')).toBe(
      'Charging the saved card [redacted] for the renewal.'
    )
  })

  it('leaves Luhn-invalid long digit runs untouched', () => {
    expect(redactPii('Correlating with order 1234567890123456 in the warehouse.')).toBe(
      'Correlating with order 1234567890123456 in the warehouse.'
    )
  })

  it('redacts US social security numbers with dash, space, or dot separators', () => {
    for (const ssn of ['123-45-6789', '123 45 6789', '123.45.6789']) {
      expect(redactPii(`Verifying identity with SSN ${ssn} for the claim.`)).toBe(
        'Verifying identity with SSN [redacted] for the claim.'
      )
    }
  })

  it('does not treat a bare 9-digit number as an SSN', () => {
    expect(redactPii('Looking up record 123456789 in the ledger.')).toBe('Looking up record 123456789 in the ledger.')
  })

  it('redacts cards grouped with dots or slashes without leaking a trailing digit', () => {
    for (const card of ['4111.1111.1111.1111', '4111/1111/1111/1111']) {
      expect(redactPii(`Charging the saved card ${card} today.`)).toBe('Charging the saved card [redacted] today.')
    }
  })

  it('redacts identifiers grouped with Unicode (NBSP) spaces copied from web pages', () => {
    const NBSP = String.fromCharCode(0x00a0)
    const NNBSP = String.fromCharCode(0x202f)
    expect(redactPii(`Charging card 4111${NBSP}1111${NBSP}1111${NBSP}1111 now.`)).toBe('Charging card [redacted] now.')
    expect(redactPii(`Calling the customer on 415${NNBSP}555${NNBSP}0132 today.`)).toBe(
      'Calling the customer on [redacted] today.'
    )
  })

  it('redacts multiple identifiers in one string', () => {
    expect(redactPii('Emailing bob@example.com and calling +1-202-555-0170 about the issue.')).toBe(
      'Emailing [redacted] and calling [redacted] about the issue.'
    )
  })

  it('does not touch ordinary prose, versions, dates, or code separators', () => {
    const clean = 'Upgrading to v1.2.3 on 2024-01-15 by refactoring std::vector usage for the team.'
    expect(redactPii(clean)).toBe(clean)
  })

  it('returns the input unchanged when there is no PII', () => {
    const intent = 'Searching the organization repositories to prioritize open performance issues.'
    expect(redactPii(intent)).toBe(intent)
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

  it('still redacts an email with a maximal 64-char local part', () => {
    const local = 'a'.repeat(64)
    expect(redactPii(`from ${local}@example.com now`)).toBe('from [redacted] now')
  })
})
