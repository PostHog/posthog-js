/**
 * The single place this package reads an HTTP request header.
 *
 * The MCP SDK hands us `IsomorphicHeaders` — a plain
 * `Record<string, string | string[] | undefined>`, not a `Headers` instance — so
 * values come out by bracket access rather than `.get()`. MCP SDK v2 plans to
 * pass a real `Headers` object instead; funnelling every read through here keeps
 * that migration a one-function change instead of a hunt for bracket lookups.
 */

/**
 * Reads one header value out of an `IsomorphicHeaders` bag. `name` must be
 * lower-cased: the HTTP transports build the bag with
 * `Object.fromEntries(req.headers.entries())` and the Fetch spec lower-cases
 * header names. A hand-rolled transport can still hand us mixed-case keys, so a
 * case-insensitive scan backs up the direct lookup.
 *
 * Repeated headers arrive as an array — we take the first entry, since every
 * header we read is single-valued by definition. Returns `undefined` for a
 * missing, non-string, or blank value, and never throws: a malformed header from
 * an untrusted client must not break the request it rode in on.
 */
export function readHeaderValue(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') {
    return undefined
  }
  const record = headers as Record<string, unknown>
  let value = record[name]
  if (value === undefined) {
    const key = Object.keys(record).find((k) => k.toLowerCase() === name)
    value = key === undefined ? undefined : record[key]
  }
  return normalizeHeaderString(value)
}

/**
 * Coerces one raw header value into a clean string, or `undefined`.
 *
 * Exported so the custom-dispatcher path can apply the same rules to values a host
 * read off the request itself. Without it the two integration paths emit different
 * properties for the *same* request: a whitespace-only header would survive as a junk
 * value, and a repeated header would reach the wire as an array, because the
 * downstream length cap passes non-strings through untouched.
 */
export function normalizeHeaderString(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  if (typeof first !== 'string') {
    return undefined
  }
  const trimmed = first.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
