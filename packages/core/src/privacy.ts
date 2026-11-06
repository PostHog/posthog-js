// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

export interface TextSanitizationOptions {
  maxStringLength: number
  truncationSuffix: string
  /** Applies {@link redactPayloadPii} to captured strings and object keys, and redacts numbers that pass as card numbers. */
  redactPayloadPersonalData?: boolean
}

const REDACTED_VALUE = '[redacted]'
const BINARY_REDACTED_VALUE = '[binary data redacted - not supported by PostHog MCP analytics]'
const BASE64_PATTERN = /^[A-Za-z0-9+/\n\r]+=*$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/
const BASE64URL_SPECIFIC_CHAR_PATTERN = /[-_]/
const BASE64_DATA_URL_PREFIX_PATTERN = /^data:[^,\s]*;base64,/i
const BASE64_DATA_URL_PAYLOAD_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/
const SIZE_GATE = 10_240
const POSTHOG_TOKEN_PATTERN = /\bph[a-z]_[A-Za-z0-9_-]{20,}\b/g
const SENSITIVE_KEY_PATTERN =
  /^(authorization|cookie|set-cookie|x-api-key|api[-_]?key|api[-_]?token|access[-_]?token|refresh[-_]?token|token|password|secret|client[-_]?secret|private[-_]?key)$/i

// Deliberately no leading `\b`: `_` is a word character but not scheme-legal, so
// `resource_https://user:pw@host` has no boundary to anchor to and would keep its
// credentials. Leftmost matching makes `foo.https://x` match from `f` with scheme
// `foo.https`, which redacts the same URL and is therefore harmless.
//
// `'` is a valid URI sub-delimiter, so the terminal class must not stop at one:
// excluding it truncated `https://example.com/o'reilly?token=x` at the path and
// shipped the token in the clear. Only the characters that are never valid
// unencoded in a URI are excluded.
//
// The authority is optional too. An MCP resource URI frequently has none
// (`resource:guide?token=x`, `file:/guide.md`), and requiring `//` let those
// through untouched; `[^\s<>"]+` absorbs a `//host` when there is one. The cost
// is over-matching ordinary prose (`Error:foo`, `at12:30`, `C:\path`), which is
// harmless: a match with nothing to redact is returned byte-for-byte, so the
// text around it is never rewritten.
const URL_PATTERN = /[a-z][a-z0-9+.-]{0,63}:[^\s<>"]+/gi
// A character no URL match can contain, so a cut just after one splits no URL.
const URL_END_PATTERN = /[\s<>"]/
/** The same pattern without `g`, for asking whether a value holds a URL at all. */
const URL_PATTERN_ONCE = /* @__PURE__ */ (() => new RegExp(URL_PATTERN.source, 'i'))()
/** Finds the first scheme that brings a real authority, i.e. what the pattern required before it went authority-less. */
const URL_AUTHORITY_SEARCH = /[a-z][a-z0-9+.-]{0,63}:\/\//i
/** The same, anchored: does this match *open* with an authority? */
const URL_AUTHORITY_PATTERN = /* @__PURE__ */ (() => new RegExp(`^${URL_AUTHORITY_SEARCH.source}`, 'i'))()
/** Every authority start in a value, in order. */
const URL_AUTHORITY_SEARCH_ALL = /* @__PURE__ */ (() => new RegExp(URL_AUTHORITY_SEARCH.source, 'gi'))()
/** The field separators. `?` and `#` are structural only as delimiters — see {@link isStructural}. */
const URL_FIELD_CHARACTERS = '=&'
/** The legacy field separator. Never split on, only checked; see {@link sanitizeUrlFieldValue}. */
const LEGACY_FIELD_SEPARATOR = ';'
// The terminal class above also absorbs the prose punctuation that follows a URL
// in a sentence, `'` included now that a URL can contain one. See
// `splitTrailingPunctuation`.
const URL_TRAILING_PUNCTUATION = ".,;:!?)]}'"
const MAX_URL_LENGTH = 8192
const MAX_URL_QUERY_FIELDS = 128
// A query key is sensitive when any `-`/`_`/`.`/`/`/`;`-delimited segment names
// a credential, so compound names (`private_token`, `oauth_signature`,
// `subscription-key`, `X-Amz-Security-Token`, `Key-Pair-Id`) are covered without
// enumerating every vendor's spelling. `/` is a separator because a fragment's
// field list can be written `#/token=…`, and `;` because a legacy `;`-separated
// pair parses into a single key (`download;token`) — either would otherwise hide
// the name. Over-redacting a benign `sort_key` — or `sort/key`, or `sort;key` —
// is the accepted trade for an analytics payload.
const SENSITIVE_QUERY_KEY_SEGMENT_PATTERN =
  /(^|[-_./;])(auth|token|secret|password|passwd|pwd|credential|signature|sig|key|hmac|sas|bearer|jwt|session|sessionid)([-_./;]|$)/i
// `code` — the OAuth authorization code — is matched only as a whole key: as a
// segment it would eat `country_code`, `zip_code`, and `lang_code`.
const SENSITIVE_QUERY_KEY_EXACT_PATTERN = /^(code|AWSAccessKeyId|GoogleAccessId|Policy)$/i

// PII redaction for the agent-narrated intent string only. `$mcp_intent` is free
// text the calling LLM writes into the injected `context` argument, so it can
// carry personal data the model read aloud despite being told not to. We redact
// well-defined *structured identifiers* — the kind regex can match with high
// precision. Person names and postal addresses are deliberately out of scope:
// they need an NER model that a client SDK cannot ship, and naive patterns would
// over-redact ordinary prose. Patterns are ordered so an earlier pass never eats
// digits a later pass needs (email before phone, IPs before phone, cards before
// the generic phone pass). See `redactPii`.
// Horizontal Unicode spaces (NBSP, narrow NBSP, ideographic space, ...) are what
// appear when text is copied from web pages or PDFs. `redactPii` normalizes them
// to an ASCII space first so the separator-based card/phone/SSN candidates match
// them instead of leaking the identifier they group.
const UNICODE_SPACE_PATTERN = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g
// Quantifiers are bounded to RFC-ish limits (local-part <=64, domain <=255,
// TLD <=24) rather than open-ended `+`. Unbounded `+` here is quadratic: on a
// long run of local-part chars with no valid `.tld`, `replace` rescans from
// every start position. `$mcp_intent` is attacker-influenceable free text seen
// before truncation, so an open-ended pattern is a reachable event-loop stall.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g
const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g
// Four forms: full 8-group, `::`-terminated (`2001:db8::`), a middle `::`
// (`2001:db8::8a2e:1`), and a leading `::` (`::1`). The compressed branches use a
// captured-prefix boundary so a hex-looking C++ scope like `std::bad` — whose
// left side is not a valid hex group — is not mistaken for an address, while a
// genuinely address-shaped `dead::beef` still matches. Capturing the prefix
// avoids lookbehind, which the browser SDK's ES5 bundle cannot contain.
const IPV6_PATTERN =
  /(^|[^\w:])((?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,5}|::(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})))(?=$|[^\w:])/g
// A separator (space, dot, or dash) is required between the 3-2-4 groups so bare
// 9-digit IDs are never mistaken for an SSN.
const US_SSN_PATTERN = /\b\d{3}[ .-]\d{2}[ .-]\d{4}\b/g
// How cards are printed when grouped, shortest first so a field after a card is
// left for its own pattern. An ungrouped card is one run of 13–19 digits.
const CARD_GROUPINGS = [
  [4, 4, 4, 4],
  [4, 4, 4, 4, 3],
  [4, 6, 4],
  [4, 6, 5],
]
// Phone matching is structural rather than "any 10–15 digits", so dates
// (`2024-01-15 12:30`) and dotted versions are not mistaken for numbers. Two
// forms: a North-American 3-3-4 grouping, and an international number that must
// start with `+` and a country code. The area code is either `(415)` (the
// separator after it is optional, so `(415)555-0142` matches) or a bare `415`
// that must be followed by a separator (space, dot, dash, or slash) — so a bare
// digit run is never taken for a phone number.
const PHONE_NANP_PATTERN = /(^|[^\w+])((?:\+?1[ ./-]?)?(?:\(\d{3}\)[ ./-]?|\d{3}[ ./-])\d{3}[ ./-]\d{4})(?![\w])/g
const PHONE_INTL_PATTERN = /(^|[^\w])(\+\d{1,3}(?:[ ./()-]{0,2}\d){7,13})(?![\w])/g

// The payload pass is narrower because tool payloads carry identifiers that only
// look like personal data: versions glued to a letter, digit, or `.`, internal
// addresses, and `415-555-0142`-shaped order numbers.
const PAYLOAD_IPV4_PATTERN =
  /(^|[^A-Za-z0-9.])((?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))(?!\d|\.\d)/g
const NON_PUBLIC_IPV4_RANGES = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '0.0.0.0/32',
]
const PHONE_PARENTHESIZED_PATTERN = /(^|[^\w+])((?:\+?1[ ./-]?)?\(\d{3}\)[ ./-]?\d{3}[ ./-]\d{4})(?![\w])/g
// Not after a `.`, where `00` or `011` starts a fraction's digits, nor after a
// `-`, where it is the last group of a dashed number (`874-426-0063`).
const PAYLOAD_PHONE_INTL_PATTERN = /(^|[^\w.-])((?:\+|00|011)[ .-]?[1-9]\d{0,2}(?:[ ./()-]{0,2}\d){7,13})(?![\w])/g
// A number in JSON value position: after `:`, `,` or `[`, and before `,`, `}` or `]`.
const JSON_NUMBER_PATTERN = /([:,[]\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}\]])/g
const JSON_NUMBER_PARTS_PATTERN = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/
const WORD_CHARACTER_PATTERN = /\w/
// A JSON or JavaScript string escape. Read as text, its letter or hex digits glue
// to what follows: `"x\nada@example.com"` holds the address `nada@example.com`,
// and `"x\n4111…"` has no boundary before the card.
const ESCAPE_PATTERN = /\\(?:["\\/bfnrt]|u[0-9A-Fa-f]{4})/g
// What the identifier patterns read in place of an escaped control character,
// quote, or backslash: neither a word character nor any pattern's separator, so
// it ends an identifier without joining the digit groups on either side of it.
const ESCAPE_MASK = '\u0000'
// What they read in place of a non-ASCII character other than a space, escaped or
// not: legal in an address's local part, so `josé@example.com` is redacted whole,
// but not a word character, so a card written right before one still ends there.
const NON_ASCII_STAND_IN = '%'
const NON_ASCII_PATTERN = /[\u0080-\uffff]/g

function shouldRedactKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

function shouldRedactQueryKey(key: string): boolean {
  return (
    shouldRedactKey(key) || SENSITIVE_QUERY_KEY_SEGMENT_PATTERN.test(key) || SENSITIVE_QUERY_KEY_EXACT_PATTERN.test(key)
  )
}

function isBase64DataUrl(value: string): boolean {
  const prefix = BASE64_DATA_URL_PREFIX_PATTERN.exec(value)
  if (!prefix) {
    return false
  }

  let payload: string
  try {
    payload = decodeURIComponent(value.slice(prefix[0].length))
  } catch {
    return false
  }

  return BASE64_DATA_URL_PAYLOAD_PATTERN.test(payload.replace(/[\r\n]/g, ''))
}

function exceedsUrlFieldLimit(fields: string): boolean {
  return fields.split('&', MAX_URL_QUERY_FIELDS + 1).length > MAX_URL_QUERY_FIELDS
}

/** How much of the sanitizer one call is allowed to apply. */
interface UrlSanitizeMode {
  /** Sanitize a URL found inside a retained field value. Off past depth 1. */
  allowNestedUrls: boolean
  /** Split prose punctuation off the end. Off when the match is a whole string. */
  stripPunctuation: boolean
}

/** Whether any `;`-separated piece of `value` names a credential. */
function hasLegacySensitiveField(value: string): boolean {
  return value.split(LEGACY_FIELD_SEPARATOR).some((piece) => shouldRedactQueryKey(piece.split('=', 1)[0]))
}

/** The sanitized value of one query or fragment field. */
function sanitizeUrlFieldValue(key: string, value: string, allowNestedUrls: boolean): string {
  if (shouldRedactQueryKey(key)) {
    return REDACTED_VALUE
  }
  // `;` once separated fields the way `&` does, so a value carrying one may hold
  // a credential field inside it. Splitting on it is not an option — that cuts a
  // credential's own value in two and publishes the tail as a bare key
  // (`?password=prefix;rest`) — so instead the whole value goes when any piece
  // of it names a credential.
  if (value.includes(LEGACY_FIELD_SEPARATOR) && hasLegacySensitiveField(value)) {
    return REDACTED_VALUE
  }
  if (!URL_PATTERN_ONCE.test(value)) {
    return value
  }
  // One level of nesting is the whole budget. Past it a URL-bearing value is
  // dropped rather than trusted: nothing deeper would sanitize it, so a gateway
  // address wrapping a gateway address would otherwise ship its credentials.
  return allowNestedUrls
    ? sanitizeUrlsInString(value, { allowNestedUrls: false, stripPunctuation: true })
    : REDACTED_VALUE
}

/**
 * Redacts the values of credential-named fields in one `&`-separated field list
 * — a query string or a fragment. `serialized` is only meaningful when `changed`
 * is true, so an untouched part keeps its original encoding instead of being
 * re-serialized. `lastFieldSensitive` says whether whatever follows the list
 * could be more of a credential, which is what decides both the fragment tail
 * and restored prose punctuation; see {@link sanitizeUrl}.
 */
function sanitizeUrlFields(
  fields: string,
  allowNestedUrls: boolean
): { changed: boolean; lastFieldSensitive: boolean; serialized: string } {
  const sanitized = new URLSearchParams()
  let changed = false
  let lastFieldSensitive = false
  // Parsing decodes each field, which can turn an encoded PostHog token
  // (`%70hx_...`) into a plain one, so tokens are redacted again after decoding.
  for (const [decodedKey, decodedValue] of new URLSearchParams(fields)) {
    const key = redactCredentials(decodedKey)
    const value = redactCredentials(decodedValue)
    changed ||= key !== decodedKey || value !== decodedValue
    const sanitizedValue = sanitizeUrlFieldValue(key, value, allowNestedUrls)
    // `changed` is compared, not inferred from the key: the PostHog-token pass
    // runs first, so a value can already read `[redacted]`, and calling that a
    // change would re-serialize the field only to percent-encode it.
    changed ||= sanitizedValue !== value
    // Sensitivity is the separate question — whether what follows this field
    // could be more of a credential — and an already-redacted value is still a
    // credential's field.
    lastFieldSensitive = shouldRedactQueryKey(key) || sanitizedValue !== value
    sanitized.append(key, sanitizedValue)
  }
  return { changed, lastFieldSensitive, serialized: sanitized.toString() }
}

/**
 * Splits the prose punctuation that follows a URL in a sentence off the end of a
 * match, so it is not parsed as part of the address and can be re-appended
 * verbatim to whatever the sanitizer returns.
 *
 * Walked back character by character rather than matched with a `$`-anchored
 * pattern: a captured URI is attacker-influenceable, and on a long punctuation
 * run that does not end the match a backtracking pattern is quadratic.
 */
function splitTrailingPunctuation(value: string): { address: string; suffix: string } {
  let end = value.length
  while (end > 0 && URL_TRAILING_PUNCTUATION.includes(value[end - 1])) {
    end--
  }
  return { address: value.slice(0, end), suffix: value.slice(end) }
}

/**
 * A fragment's tail, given how its head came out.
 *
 * A `?` inside a credential looks exactly like the one between a route and its
 * fields. So when the head's last field is a credential's, everything after that
 * `?` may be the rest of its value — `#password=prefix?rest` — and the
 * tail goes whole rather than being read on its own terms. An empty tail has
 * nothing to hide and stays empty. Either way it counts as a rewritten trailing
 * field, so prose punctuation after the URL goes with it for the same reason.
 */
function sanitizeFragmentTail(
  tail: string,
  headLastFieldSensitive: boolean,
  allowNestedUrls: boolean
): { value: string; lastFieldSensitive: boolean } {
  if (!headLastFieldSensitive) {
    return sanitizeFragmentPart(tail, allowNestedUrls)
  }
  return { value: tail === '' ? '' : REDACTED_VALUE, lastFieldSensitive: true }
}

/**
 * Splits a fragment at its first `?`. `tail` is null when there is none.
 *
 * Nothing is assumed about either part. Shape alone cannot tell a router's route
 * from a field list — `#/docs/id=1?token=…` puts an `=` in the route, and
 * `#/token=…&next=https://x/?page=1` puts a `/` and a `?` in a field list — so
 * each part is read as fields when it holds an `=` and as text otherwise.
 */
function splitFragmentParts(hash: string): { head: string; tail: string | null } {
  const fragment = hash.slice(1)
  const separator = fragment.indexOf('?')
  if (separator < 0) {
    return { head: fragment, tail: null }
  }
  return { head: fragment.slice(0, separator), tail: fragment.slice(separator + 1) }
}

/** One fragment part, and whether its last field was rewritten. */
function sanitizeFragmentPart(part: string, allowNestedUrls: boolean): { value: string; lastFieldSensitive: boolean } {
  if (!part.includes('=')) {
    return { value: sanitizeFragmentText(part, allowNestedUrls), lastFieldSensitive: false }
  }
  const fields = sanitizeUrlFields(part, allowNestedUrls)
  // Verbatim unless something was actually rewritten: only the part that changed
  // should change encoding.
  return { value: fields.changed ? fields.serialized : part, lastFieldSensitive: fields.lastFieldSensitive }
}

/**
 * Sanitizes the part of a fragment that is text rather than fields — a plain
 * `#intro`, or the route in front of a field list. It is text, and text can
 * carry an address, so it gets the URL pass.
 *
 * Depth is capped the way a field value's is: at the nested level a URL-bearing
 * text is dropped rather than descended into. That is also what stops
 * `resource:x#resource:x#…` from recursing once per `#`.
 */
function sanitizeFragmentText(text: string, allowNestedUrls: boolean): string {
  if (!allowNestedUrls) {
    return URL_PATTERN_ONCE.test(text) ? REDACTED_VALUE : text
  }
  return sanitizeUrlsInString(text, { allowNestedUrls: false, stripPunctuation: true })
}

/**
 * Every offset inside `value` where an adjacent address starts; see
 * {@link sanitizeUrl}.
 *
 * An authority is in *value position* — left alone, because the field pass
 * already gives it the nested pass — when a field name's `=` is the nearest
 * structural character behind it. Structural means a field separator (`=`, `&`,
 * `;`) or one of the URL's three delimiters; see {@link isDelimiter}. Before any
 * delimiter no `=` has been seen, so `…/redirect=https://user:pw@host` is two
 * addresses rather than one field.
 *
 * Decided in one forward walk, not a backward scan per authority. The scan was
 * quadratic on a value that opens its fields once and then runs thousands of
 * addresses together, because every one of them scanned back to the same `?`.
 */
function findEmbeddedAuthorityIndexes(value: string): number[] {
  // The search tries up to 64 scheme characters at every position, which a long
  // base64 `data:` URI turns into seconds; without `://` it cannot match at all.
  if (!value.includes('://')) {
    return []
  }
  const starts = [...value.matchAll(URL_AUTHORITY_SEARCH_ALL)].map((match) => match.index)
  const indexes: number[] = []
  const delimiters = { query: false, fragment: false, fragmentQuery: false }
  let pending = 0
  let inFields = false
  let lastStructural = ''
  for (let cursor = 0; cursor < value.length && pending < starts.length; cursor++) {
    if (starts[pending] === cursor) {
      if (cursor > 0 && lastStructural !== '=') {
        indexes.push(cursor)
      }
      pending++
    }
    const character = value[cursor]
    if (isDelimiter(character, delimiters, lastStructural)) {
      lastStructural = character
      inFields = true
    } else if (inFields && URL_FIELD_CHARACTERS.includes(character)) {
      lastStructural = character
    }
  }
  return indexes
}

/**
 * Whether this `?` or `#` is one of a URL's three delimiters, consuming it if so.
 *
 * A URL has exactly one query delimiter, one fragment delimiter, and — matching
 * how the fragment is split — one delimiter between the fragment's own head and
 * tail. Every other `?` or `#` is ordinary text inside a value, and reading one
 * as structural would cut `?token=prefix?https://secret/…` in half at a `?` that
 * belongs to the token.
 */
function isDelimiter(
  character: string,
  seen: { query: boolean; fragment: boolean; fragmentQuery: boolean },
  lastStructural: string
): boolean {
  if (character === '#') {
    return seen.fragment ? false : (seen.fragment = true)
  }
  if (character !== '?') {
    return false
  }
  if (seen.fragment) {
    // Inside a fragment, a `?` right after a field name may belong to that
    // field's value rather than open the tail. Leaving it unstructural keeps a
    // following address attached, so the fragment split and its fail-closed tail
    // rule get to decide — they can see the whole credential, this cannot.
    if (lastStructural === '=') {
      return false
    }
    return seen.fragmentQuery ? false : (seen.fragmentQuery = true)
  }
  return seen.query ? false : (seen.query = true)
}

/**
 * Redacts the credentials embedded in one URL-shaped match: the userinfo, plus
 * the values of credential-named query and fragment fields. A retained value that
 * is itself a URL — a gateway's `?url=` passthrough — gets the same pass one
 * level deep.
 *
 * One match can hold more than one address: a prose word in front of it
 * (`Failed URL:https://…`, `a:b:https://…`), several run together
 * (`…/doc,https://…`), or one parked in another's query or fragment
 * (`…/?download)[b](https://…`). The later address always begins inside what
 * would parse as the earlier one's path, query key, or fragment — none of which
 * is examined for userinfo — so it is cut out and sanitized on its own.
 *
 * The exception is an authority in value position (see
 * {@link findEmbeddedAuthorityIndexes}), which the field pass already gives the
 * nested pass. Cutting there would take a gateway's `?url=https://…` out of the
 * field it belongs to.
 *
 * One pass, no recursion: after the cuts, every authority left inside a piece is
 * either at its start or in value position, so no piece can need cutting again.
 *
 * Every piece but the last is sanitized without the punctuation split: it is
 * followed by an address rather than by prose, so its last character is a
 * separator, not a sentence's. (It matters — stripping the `:` off `URL:` would
 * leave `URL`, which `new URL()` rejects, and the prose word would become
 * `[redacted]`.)
 */
function sanitizeUrl(value: string, mode: UrlSanitizeMode): string {
  const embedded = findEmbeddedAuthorityIndexes(value)
  if (embedded.length === 0) {
    return sanitizeSingleUrl(value, mode)
  }
  let result = ''
  let start = 0
  for (const index of embedded) {
    result += sanitizeSingleUrl(value.slice(start, index), { ...mode, stripPunctuation: false })
    start = index
  }
  return result + sanitizeSingleUrl(value.slice(start), mode)
}

/** {@link sanitizeUrl} for a value already known to hold exactly one address. */
function sanitizeSingleUrl(value: string, mode: UrlSanitizeMode): string {
  // The length bound caps the work an attacker-shaped address can force, so it
  // only applies to a match that has an authority. A long authority-less match
  // is usually a data URI; it is parsed like any other, which is linear in
  // `new URL()` and still capped by the field bound below, and comes back
  // byte-for-byte when it holds nothing to redact.
  if (value.length > MAX_URL_LENGTH && URL_AUTHORITY_PATTERN.test(value)) {
    return REDACTED_VALUE
  }

  const { address, suffix } = mode.stripPunctuation ? splitTrailingPunctuation(value) : { address: value, suffix: '' }
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return REDACTED_VALUE + suffix
  }

  const query = url.search.slice(1)
  const hasFragment = url.hash !== ''
  const fragment = splitFragmentParts(url.hash)
  if (exceedsUrlFieldLimit(query) || exceedsUrlFieldLimit(fragment.head) || exceedsUrlFieldLimit(fragment.tail ?? '')) {
    return REDACTED_VALUE + suffix
  }

  let changed = false
  if (url.username || url.password) {
    url.username = REDACTED_VALUE
    url.password = ''
    changed = true
  }
  const sanitizedQuery = sanitizeUrlFields(query, mode.allowNestedUrls)
  if (sanitizedQuery.changed) {
    url.search = sanitizedQuery.serialized
    changed = true
  }
  const sanitizedHead = sanitizeFragmentPart(fragment.head, mode.allowNestedUrls)
  const sanitizedTail =
    fragment.tail === null
      ? null
      : sanitizeFragmentTail(fragment.tail, sanitizedHead.lastFieldSensitive, mode.allowNestedUrls)
  const sanitizedHash = sanitizedTail === null ? sanitizedHead.value : `${sanitizedHead.value}?${sanitizedTail.value}`
  if (sanitizedHash !== url.hash.slice(1)) {
    url.hash = sanitizedHash
    changed = true
  }

  // The punctuation split off the end may be the tail of the very credential
  // just replaced (`?password=fakepass!!!`) rather than the sentence's. When the
  // last field of the URL's trailing part is a credential's the punctuation goes
  // with it; losing a comma from the surrounding prose is the accepted cost of
  // not shipping `!!!`.
  const trailingFields = hasFragment ? (sanitizedTail ?? sanitizedHead) : sanitizedQuery
  // Serializing writes the host decoded, which can expose an encoded PostHog token.
  return (changed ? redactCredentials(url.toString()) : address) + (trailingFields.lastFieldSensitive ? '' : suffix)
}

/**
 * Replaces every URL-shaped match in `text`.
 *
 * A match that IS the whole string is an address rather than prose — a captured
 * `$mcp_resource_name`, a `params.uri`, a nested `?url=` value — so nothing is
 * split off its end: a trailing `!` there belongs to the URL.
 */
function sanitizeUrlsInString(text: string, mode: UrlSanitizeMode): string {
  return text.replace(URL_PATTERN, (match) =>
    sanitizeUrl(match, { ...mode, stripPunctuation: mode.stripPunctuation && match.length !== text.length })
  )
}

/** Whether a string is large enough, and shaped enough like base64, to be a blob. */
function isBinaryBlob(value: string): boolean {
  return (
    value.length >= SIZE_GATE &&
    (BASE64_PATTERN.test(value) ||
      isBase64DataUrl(value) ||
      (BASE64URL_SPECIFIC_CHAR_PATTERN.test(value) && BASE64URL_PATTERN.test(value)))
  )
}

/** Replaces PostHog API keys wherever they appear in a string. */
function redactCredentials(value: string): string {
  return redactIdentifiers(value, [[matching(POSTHOG_TOKEN_PATTERN), redactWhole]])
}

/** Replaces every URL-shaped match, credentials and all. */
function redactUrls(value: string): string {
  return sanitizeUrlsInString(value, { allowNestedUrls: true, stripPunctuation: true })
}

function scanWindowLength(options: TextSanitizationOptions): number {
  return 4 * options.maxStringLength
}

/**
 * Runs `redact` over only the window of `value` that truncation can keep, so a
 * multi-megabyte tool result costs about the same as the part captured.
 * Redaction shrinks text, so a window that ends up too short to cover
 * truncation's cut doubles, up to four times its first length. The kept part
 * reads as the start of what redacting the whole string would give.
 */
function redactCapturedHead(
  value: string,
  redact: (value: string) => string,
  options: TextSanitizationOptions,
  windowLength = scanWindowLength(options)
): string {
  return value.length > windowLength
    ? keepHead(
        redact(value.slice(0, windowLength)),
        windowLength,
        () => redactCapturedHead(value, redact, options, 2 * windowLength),
        options
      )
    : redact(value)
}

/**
 * {@link redactCapturedHead} with the URL pass after `redact`. A URL is redacted
 * or kept on the whole address, and the part that decides it, such as the `@`
 * closing a user, can sit past the window, so a URL that runs past the window is
 * replaced whole and nothing after it is read.
 */
function redactCapturedText(
  value: string,
  redact: (value: string) => string,
  options: TextSanitizationOptions,
  windowLength = scanWindowLength(options)
): string {
  if (value.length <= windowLength) {
    return redactUrls(redact(value))
  }
  const head = redact(value.slice(0, windowLength))
  const urlStart = URL_END_PATTERN.test(value[windowLength]) ? -1 : trailingUrlStart(head)
  return urlStart === -1
    ? keepHead(
        redactUrls(head),
        windowLength,
        () => redactCapturedText(value, redact, options, 2 * windowLength),
        options
      )
    : redactUrls(head.slice(0, urlStart)) + REDACTED_VALUE + options.truncationSuffix
}

function keepHead(
  head: string,
  windowLength: number,
  redactWiderWindow: () => string,
  options: TextSanitizationOptions
): string {
  // Twice what truncation keeps, so a match split where the head was cut sits
  // past the part truncation keeps.
  if (head.length >= 2 * options.maxStringLength) {
    return head + options.truncationSuffix
  }
  // At the widest window, drop the stretch a split match could sit in instead.
  return windowLength < 4 * scanWindowLength(options)
    ? redactWiderWindow()
    : head.slice(0, -options.maxStringLength) + options.truncationSuffix
}

/** Where the URL that runs to the end of `text` starts, or -1. */
function trailingUrlStart(text: string): number {
  let lastUrlEnd = text.length
  while (lastUrlEnd > 0 && !URL_END_PATTERN.test(text[lastUrlEnd - 1])) {
    lastUrlEnd--
  }
  const url = URL_PATTERN_ONCE.exec(text.slice(lastUrlEnd))
  return url ? lastUrlEnd + url.index : -1
}

function sanitizeString(value: string, options: TextSanitizationOptions): string {
  if (isBinaryBlob(value)) {
    return BINARY_REDACTED_VALUE
  }
  const redactPersonalData = options.redactPayloadPersonalData ? redactPayloadPii : (head: string) => head
  return redactCapturedText(value, (head) => redactPersonalData(redactCredentials(head)), options)
}

/**
 * Sanitizes agent-narrated free text (`$mcp_intent`, the `send_feedback`
 * fields): structured PII on top of the passes every captured string gets.
 *
 * Every step of the order is load-bearing. The binary gate reads the value as it
 * arrived, because splicing `[redacted]` into a blob — a Luhn-valid run inside
 * base64 is enough — stops it looking like base64 and would ship it whole.
 * Credentials go before PII, because a PII pattern can cut a token in half (a
 * phone-shaped run inside one) and leave the halves behind. PII goes before the
 * URL pass, because the URL rewrite percent-encodes the `@` that the email
 * pattern anchors on.
 */
export function sanitizeFreeText(value: string, options: TextSanitizationOptions): string {
  if (isBinaryBlob(value)) {
    return BINARY_REDACTED_VALUE
  }
  return redactCapturedText(value, (head) => redactPii(redactCredentials(head)), options)
}

function passesLuhn(digits: string): boolean {
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = digits.charCodeAt(index) - 48
    if (digit < 0 || digit > 9) {
      return false
    }
    if (double) {
      digit *= 2
      if (digit > 9) {
        digit -= 9
      }
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

/** Where the card that starts at digit group `first` of a run ends, or -1. */
type CardEnd = (run: string, first: number) => number

/** How a pass reads card numbers: what joins digit groups, where a run of groups may start and end, and which groups make a card. */
interface CardReading {
  separators: string
  startsAt: (text: string, index: number) => boolean
  endsAt: (text: string, index: number) => boolean
  cardEnd: CardEnd
}

function isDigitAt(text: string, index: number): boolean {
  const code = text.charCodeAt(index)
  return code >= 48 && code <= 57
}

function isWordAt(text: string, index: number): boolean {
  return index >= 0 && index < text.length && WORD_CHARACTER_PATTERN.test(text[index])
}

function digitsEnd(text: string, index: number): number {
  let end = index
  while (isDigitAt(text, end)) {
    end++
  }
  return end
}

/**
 * The intent reads any run of whole groups joined by one space, dot, dash, or
 * slash: at each group, the shortest run whose 13–19 digits pass Luhn. The
 * shortest leaves a field after the card, such as the SSN in
 * `4111111111111111 078-05-1120`, for its own pattern.
 */
const INTENT_CARDS: CardReading = {
  separators: ' ./-',
  startsAt: (text, index) => !isWordAt(text, index - 1),
  endsAt: (text, index) => !isWordAt(text, index),
  cardEnd: (run, first) => {
    let digits = ''
    for (let groupStart = first; groupStart < run.length;) {
      const groupEnd = digitsEnd(run, groupStart)
      digits += run.slice(groupStart, groupEnd)
      if (digits.length > 19) {
        return -1
      }
      if (digits.length >= 13 && passesLuhn(digits)) {
        return groupEnd
      }
      groupStart = groupEnd + 1
    }
    return -1
  },
}

/**
 * The payload reads only digits grouped by single spaces or dashes, the way
 * cards are printed: one group of 13–19 digits or one of {@link CARD_GROUPINGS}.
 * Any other grouping is a date, a phone number, or a list of ids. A `.` makes a
 * fraction or a version, so a leading `-` or `.` belongs to a negative number or
 * a fraction unless a letter comes before it (`card-4111…`, `No.4111…`), and a
 * trailing `.` and digit or a letter to a number the run is only part of.
 */
const PAYLOAD_CARDS: CardReading = {
  separators: ' -',
  startsAt: (text, index) => {
    const before = text[index - 1]
    return (
      index === 0 ||
      (before === '.' || before === '-' ? /[A-Za-z_]/.test(text[index - 2] ?? '') : !isWordAt(text, index - 1))
    )
  },
  endsAt: (text, index) => !isWordAt(text, index) && !(text[index] === '.' && isDigitAt(text, index + 1)),
  cardEnd: (run, first) => {
    const lengths: number[] = []
    for (let groupStart = first; groupStart < run.length && lengths.length < 5;) {
      const groupEnd = digitsEnd(run, groupStart)
      lengths.push(groupEnd - groupStart)
      groupStart = groupEnd + 1
    }
    if (lengths[0] >= 13) {
      return isCardDigits(run.slice(first, first + lengths[0])) ? first + lengths[0] : -1
    }
    for (const grouping of CARD_GROUPINGS) {
      const end = first + grouping.reduce((sum, length) => sum + length + 1, -1)
      if (
        grouping.every((length, index) => lengths[index] === length) &&
        passesLuhn(run.slice(first, end).replace(/\D/g, ''))
      ) {
        return end
      }
    }
    return -1
  },
}

/**
 * Finds the next run of 13 or more digits in whole groups that `reading` allows.
 * A loop rather than a pattern: a backtracking pattern over a megabyte-long run
 * of digit groups overflows the stack.
 */
function findCardRun(reading: CardReading): Finder {
  return (text, from) => {
    for (let start = from; start < text.length; start++) {
      if (!isDigitAt(text, start) || isDigitAt(text, start - 1) || !reading.startsAt(text, start)) {
        continue
      }
      let digits = 0
      let end = -1
      let groupStart = start
      for (;;) {
        const groupEnd = digitsEnd(text, groupStart)
        digits += groupEnd - groupStart
        if (digits >= 13 && reading.endsAt(text, groupEnd)) {
          end = groupEnd
        }
        groupStart = groupEnd + 1
        if (!reading.separators.includes(text[groupEnd]) || !isDigitAt(text, groupStart)) {
          break
        }
      }
      if (end >= 0) {
        return [start, end]
      }
      start = groupStart - 1
    }
    return null
  }
}

/**
 * Redacts every card in a run of digit groups. A run can hold more than one card
 * plus adjacent fields, such as an expiry or a second card, so the groups are
 * scanned left to right: a card is redacted and the scan resumes after it, and a
 * group that starts no card is kept.
 */
function redactCardsInRun(run: string, cardEnd: CardEnd): string {
  let output = ''
  let cursor = 0
  for (let first = 0; first < run.length;) {
    const end = cardEnd(run, first)
    if (end >= 0) {
      output += run.slice(cursor, first) + REDACTED_VALUE
      cursor = end
      first = end + 1
    } else {
      first = digitsEnd(run, first) + 1
    }
  }
  return output + run.slice(cursor)
}

function cardRule(reading: CardReading): Rule {
  return [findCardRun(reading), (run) => redactCardsInRun(run, reading.cardEnd)]
}

/**
 * Redacts structured personal identifiers (emails, IP addresses, credit-card
 * numbers, US SSNs, and phone numbers) from a free-text string. Intended for the
 * agent-narrated `$mcp_intent` value only — not for structured tool parameters or
 * responses, where the same shapes are often legitimate data. Horizontal Unicode
 * spaces are first normalized to an ASCII space so copy-pasted identifiers still
 * match. Returns a new string; leaves the input's identifiers untouched when
 * nothing matches.
 */
export function redactPii(value: string): string {
  return redactIdentifiers(value, [
    [matching(EMAIL_PATTERN), redactWhole],
    [matching(IPV4_PATTERN), redactWhole],
    [matching(IPV6_PATTERN), redactWhole],
    [matching(JSON_NUMBER_PATTERN), jsonNumberRedaction((token) => isIntegerCard(token) || holdsIntentCard(token))],
    cardRule(INTENT_CARDS),
    [matching(US_SSN_PATTERN), redactWhole],
    [matching(PHONE_NANP_PATTERN), redactWhole],
    [matching(PHONE_INTL_PATTERN), redactWhole],
  ])
}

function holdsIntentCard(text: string): boolean {
  return redactIdentifiers(text, [cardRule(INTENT_CARDS)]) !== text
}

/** What one identifier is replaced with, given where it starts in the text the patterns read. */
type Redaction = (identifier: string, start: number, read: string) => string

/** Where the next identifier at or after `from` starts and ends in the text the patterns read, if any. */
type Finder = (read: string, from: number) => [start: number, end: number] | null

type Rule = [find: Finder, redact: Redaction]

const redactWhole: Redaction = () => REDACTED_VALUE

/**
 * A pattern that matches its identifier whole, or captures the boundary before
 * it in group 1 and the identifier in group 2.
 */
function matching(pattern: RegExp): Finder {
  return (read, from) => {
    pattern.lastIndex = from
    const match = pattern.exec(read)
    if (match === null) {
      return null
    }
    const end = match.index + match[0].length
    return [end - (match[2] ?? match[0]).length, end]
  }
}

/** A text as the identifier patterns read it, and where each of its characters came from. */
interface EscapeReading {
  read: string
  /** The offset in the text of the character the patterns read at `index`; `read.length` maps to the text's end. */
  offset: (index: number) => number
}

/** Horizontal Unicode spaces read as an ASCII space, and other non-ASCII characters as {@link NON_ASCII_STAND_IN}. */
function readCharacters(text: string): string {
  return text.replace(UNICODE_SPACE_PATTERN, ' ').replace(NON_ASCII_PATTERN, NON_ASCII_STAND_IN)
}

/**
 * Reads `text` as {@link readCharacters} does, and each escape in it as one
 * character: an escaped control character, quote, or backslash as
 * {@link ESCAPE_MASK}, and any other `\uXXXX` as the character it encodes would
 * read, so `ada\u0040example.com` and `4111\u00201111…` read as what they are.
 */
function readEscapes(text: string): EscapeReading {
  const spaced = readCharacters(text)
  if (!text.includes('\\')) {
    return { read: spaced, offset: (index) => index }
  }
  const offsets = new Int32Array(text.length + 1)
  let read = ''
  let cursor = 0
  const copyUpTo = (end: number): void => {
    for (let index = cursor; index < end; index++) {
      offsets[read.length + index - cursor] = index
    }
    read += spaced.slice(cursor, end)
  }
  for (const escape of spaced.matchAll(ESCAPE_PATTERN)) {
    copyUpTo(escape.index)
    offsets[read.length] = escape.index
    read += escapeStandIn(escape[0])
    cursor = escape.index + escape[0].length
  }
  copyUpTo(text.length)
  offsets[read.length] = text.length
  return { read, offset: (index) => offsets[index] }
}

function escapeStandIn(escape: string): string {
  if (escape[1] !== 'u') {
    return ESCAPE_MASK
  }
  const code = parseInt(escape.slice(2), 16)
  if (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x22 ||
    code === 0x5c
  ) {
    return ESCAPE_MASK
  }
  return readCharacters(String.fromCharCode(code))
}

/**
 * Applies each rule in turn to `value` as {@link readEscapes} reads it, and
 * splices each replacement over the characters the identifier was read from.
 * An identifier that covers part of an escape covers all of it, so the text
 * stays valid JSON, and text outside an identifier comes back byte for byte.
 */
function redactIdentifiers(value: string, rules: Rule[]): string {
  let text = value
  let reading = readEscapes(text)
  for (const [find, redact] of rules) {
    const { read, offset } = reading
    let redacted = ''
    let cursor = 0
    for (let span = find(read, 0); span !== null; span = find(read, span[1])) {
      const identifier = read.slice(span[0], span[1])
      const replacement = redact(identifier, span[0], read)
      if (replacement !== identifier) {
        redacted += text.slice(cursor, offset(span[0])) + replacement
        cursor = offset(span[1])
      }
    }
    if (cursor > 0) {
      text = redacted + text.slice(cursor)
      reading = readEscapes(text)
    }
  }
  return text
}

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((value, octet) => value * 256 + Number(octet), 0)
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4ToNumber(address)
  return !NON_PUBLIC_IPV4_RANGES.some((range) => {
    const [network, prefixLength] = range.split('/')
    const size = 2 ** (32 - Number(prefixLength))
    return Math.floor(value / size) === ipv4ToNumber(network) / size
  })
}

/**
 * Writes a JSON number for which `isCard` holds as the string `"[redacted]"`,
 * whole, so JSON text stays valid JSON. A number stands outside every JSON
 * string when an even number of quotes precede it; escaped quotes are masked, so
 * they are not counted. The count carries over from one number to the next, so a
 * text full of numbers is read once, not once per number.
 */
function jsonNumberRedaction(isCard: (token: string) => boolean): Redaction {
  let quotes = 0
  let counted = 0
  return (token, start, read) => {
    for (; counted < start; counted++) {
      quotes += read[counted] === '"' ? 1 : 0
    }
    return quotes % 2 === 0 && isCard(token) ? `"${REDACTED_VALUE}"` : token
  }
}

function isCardDigits(digits: string): boolean {
  return /^\d{13,19}$/.test(digits) && passesLuhn(digits)
}

function isCardNumber(value: number): boolean {
  return isCardDigits(String(value))
}

/**
 * Whether a JSON number token equals a card number, read from its digits rather
 * than parsed, so a 19-digit card past 2^53 is judged exactly:
 * `4111111111111111.0` and `41111111111111110e-1` are both the card.
 */
function isIntegerCard(token: string): boolean {
  const [, whole, fraction = '', exponent = '0'] = JSON_NUMBER_PARTS_PATTERN.exec(token) ?? []
  if (whole === undefined) {
    return false
  }
  const digits = whole + fraction
  const significant = digits.replace(/^0+/, '')
  const integerLength = whole.length + Number(exponent) - (digits.length - significant.length)
  return (
    integerLength >= 13 &&
    integerLength <= 19 &&
    !/[1-9]/.test(significant.slice(integerLength)) &&
    isCardDigits(significant.slice(0, integerLength).padEnd(integerLength, '0'))
  )
}

/**
 * {@link redactPii} narrowed for tool arguments, results, and errors: an IPv4
 * address only when public and not glued to a version, and a phone number only
 * with an international prefix or a parenthesized area code. A string with
 * nothing to redact comes back as received, Unicode spaces included.
 */
export function redactPayloadPii(value: string): string {
  return redactIdentifiers(value, [
    [matching(EMAIL_PATTERN), redactWhole],
    [matching(PAYLOAD_IPV4_PATTERN), (address) => (isPublicIpv4(address) ? REDACTED_VALUE : address)],
    [matching(IPV6_PATTERN), redactWhole],
    [matching(JSON_NUMBER_PATTERN), jsonNumberRedaction((token) => token[0] !== '-' && isIntegerCard(token))],
    cardRule(PAYLOAD_CARDS),
    [matching(US_SSN_PATTERN), redactWhole],
    [matching(PHONE_PARENTHESIZED_PATTERN), redactWhole],
    [matching(PAYLOAD_PHONE_INTL_PATTERN), redactWhole],
  ])
}

export function sanitizeCapturedValue(value: unknown, options: TextSanitizationOptions): unknown {
  return sanitizeValueWith(
    value,
    options.redactPayloadPersonalData
      ? payloadPasses(options)
      : { string: (stringValue) => sanitizeString(stringValue, options) }
  )
}

function redactCardNumber(value: number): unknown {
  return isCardNumber(value) ? REDACTED_VALUE : value
}

/** What the payload personal data pass rewrites in a structure. */
function payloadPasses(options: TextSanitizationOptions): ValuePasses {
  return {
    string: (value) => sanitizeString(value, options),
    key: (key) => redactCapturedHead(key, redactPayloadPii, options),
    number: redactCardNumber,
  }
}

/**
 * {@link sanitizeCapturedValue} with the intent-grade string pass
 * ({@link sanitizeFreeText}) on every string leaf, so nested agent-narrated
 * values get structured-PII redaction in the load-bearing order too.
 */
export function sanitizeFreeTextValue(value: unknown, options: TextSanitizationOptions): unknown {
  return sanitizeValueWith(value, { string: (stringValue) => sanitizeFreeText(stringValue, options) })
}

/** What a walk rewrites. Object keys and numbers are kept as received unless a pass is given for them. */
interface ValuePasses {
  string: (value: string) => string
  key?: (key: string) => string
  number?: (value: number) => unknown
}

/** Orders by Unicode code point, which `<` does not for characters outside the Basic Multilingual Plane. */
function compareCodePoints(left: string, right: string): number {
  for (let index = 0; index < left.length && index < right.length;) {
    const leftPoint = left.codePointAt(index)!
    const rightPoint = right.codePointAt(index)!
    if (leftPoint !== rightPoint) {
      return leftPoint - rightPoint
    }
    index += leftPoint > 0xffff ? 2 : 1
  }
  return left.length - right.length
}

function sanitizeValueWith(value: unknown, passes: ValuePasses): unknown {
  if (value == null) {
    return value
  }

  if (typeof value === 'string') {
    return passes.string(value)
  }

  if (typeof value === 'number' && passes.number) {
    return passes.number(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValueWith(item, passes))
  }

  if (value instanceof Date) {
    return value
  }

  if (typeof value !== 'object') {
    return value
  }

  const result = new Map<string, unknown>()
  const receivedKeys = new Map<string, string>()
  for (const [key, nestedValue] of Object.entries(value)) {
    const sanitizedKey = passes.key ? passes.key(key) : key
    const keptKey = receivedKeys.get(sanitizedKey)
    if (keptKey !== undefined && compareCodePoints(keptKey, key) <= 0) {
      continue
    }
    receivedKeys.set(sanitizedKey, key)
    result.set(sanitizedKey, shouldRedactKey(key) ? REDACTED_VALUE : sanitizeValueWith(nestedValue, passes))
  }
  // Defined rather than assigned, so a parsed `__proto__` member stays a member instead of setting the prototype.
  return Object.fromEntries(result)
}
