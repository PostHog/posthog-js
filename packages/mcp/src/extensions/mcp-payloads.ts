// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

const CONTEXT_ARGUMENT_NAME = 'context'
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
/** The same pattern without `g`, for asking whether a value holds a URL at all. */
const URL_PATTERN_ONCE = new RegExp(URL_PATTERN.source, 'i')
/** Finds the first scheme that brings a real authority, i.e. what the pattern required before it went authority-less. */
const URL_AUTHORITY_SEARCH = /[a-z][a-z0-9+.-]{0,63}:\/\//i
/** The same, anchored: does this match *open* with an authority? */
const URL_AUTHORITY_PATTERN = new RegExp(`^${URL_AUTHORITY_SEARCH.source}`, 'i')
/** Every authority start in a value, in order. */
const URL_AUTHORITY_SEARCH_ALL = new RegExp(URL_AUTHORITY_SEARCH.source, 'gi')
/** The field separators. `?` and `#` are structural only as delimiters — see {@link isStructural}. */
const URL_FIELD_CHARACTERS = '=&;'
/** The legacy field separator. Never split on, only checked; see {@link sanitizeUrlFieldValue}. */
const LEGACY_FIELD_SEPARATOR = ';'
// The terminal class above also absorbs the prose punctuation that follows a URL
// in a sentence, `'` included now that a URL can contain one. See
// `splitTrailingPunctuation`.
const URL_TRAILING_PUNCTUATION = ".,;:!?)]}'"
const MAX_URL_LENGTH = 8192
const MAX_URL_QUERY_FIELDS = 128
// A query key is sensitive when any `-`/`_`/`.`/`/`-delimited segment names a
// credential, so compound names (`private_token`, `oauth_signature`,
// `subscription-key`, `X-Amz-Security-Token`, `Key-Pair-Id`) are covered without
// enumerating every vendor's spelling. `/` is a separator too, because a
// fragment's field list can be written `#/token=…` and the leading slash would
// otherwise hide the name. Over-redacting a benign `sort_key` — or `sort/key` —
// is the accepted trade for an analytics payload.
const SENSITIVE_QUERY_KEY_SEGMENT_PATTERN =
  /(^|[-_./])(auth|token|secret|password|passwd|pwd|credential|signature|sig|key|hmac|sas|bearer|jwt|session|sessionid)([-_./]|$)/i
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
// `(?<![\w:])` boundary so a hex-looking C++ scope like `std::bad` — whose left
// side is not a valid hex group — is not mistaken for an address, while a
// genuinely address-shaped `dead::beef` still matches.
const IPV6_PATTERN =
  /\b(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}\b|(?<![\w:])(?:[0-9A-Fa-f]{1,4}:){1,7}:(?![\w:])|(?<![\w:])(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,5}(?![\w])|(?<![\w:])::(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})(?![\w])/g
// A separator (space, dot, or dash) is required between the 3-2-4 groups so bare
// 9-digit IDs are never mistaken for an SSN.
const US_SSN_PATTERN = /\b\d{3}[ .-]\d{2}[ .-]\d{4}\b/g
// A run of >=13 digits optionally grouped by a single space, dot, dash, or
// slash. This only marks the numeric region; `redactCardInMatch` then looks for
// the actual card as a run of whole separator-delimited groups that passes Luhn,
// so an adjacent field such as an expiry (`4111 1111 1111 1111 12/30`) is not
// absorbed into a failing check that would leak the card.
const CREDIT_CARD_CANDIDATE_PATTERN = /\b\d(?:[ ./-]?\d){12,}\b/g
// Matches each separator-delimited digit group inside a card candidate.
const DIGIT_GROUP_PATTERN = /\d+/g
// Phone matching is structural rather than "any 10–15 digits", so dates
// (`2024-01-15 12:30`) and dotted versions are not mistaken for numbers. Two
// forms: a North-American 3-3-4 grouping, and an international number that must
// start with `+` and a country code. The area code is either `(415)` (the
// separator after it is optional, so `(415)555-0142` matches) or a bare `415`
// that must be followed by a separator (space, dot, dash, or slash) — so a bare
// digit run is never taken for a phone number.
const PHONE_NANP_PATTERN = /(?<![\w+])(?:\+?1[ ./-]?)?(?:\(\d{3}\)[ ./-]?|\d{3}[ ./-])\d{3}[ ./-]\d{4}(?![\w])/g
const PHONE_INTL_PATTERN = /(?<!\w)\+\d{1,3}(?:[ ./()-]{0,2}\d){7,13}(?![\w])/g

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

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
  for (const [key, value] of new URLSearchParams(fields)) {
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
    if (isDelimiter(character, delimiters)) {
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
function isDelimiter(character: string, seen: { query: boolean; fragment: boolean; fragmentQuery: boolean }): boolean {
  if (character === '#') {
    return seen.fragment ? false : (seen.fragment = true)
  }
  if (character !== '?') {
    return false
  }
  if (seen.fragment) {
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
  return (changed ? url.toString() : address) + (trailingFields.lastFieldSensitive ? '' : suffix)
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
  return value.replace(POSTHOG_TOKEN_PATTERN, REDACTED_VALUE)
}

/** Replaces every URL-shaped match, credentials and all. */
function redactUrls(value: string): string {
  return sanitizeUrlsInString(value, { allowNestedUrls: true, stripPunctuation: true })
}

function sanitizeString(value: string): string {
  return isBinaryBlob(value) ? BINARY_REDACTED_VALUE : redactUrls(redactCredentials(value))
}

/**
 * Sanitizes the agent-narrated intent: structured PII on top of the passes every
 * captured string gets.
 *
 * Every step of the order is load-bearing. The binary gate reads the value as it
 * arrived, because splicing `[redacted]` into a blob — a Luhn-valid run inside
 * base64 is enough — stops it looking like base64 and would ship it whole.
 * Credentials go before PII, because a PII pattern can cut a token in half (a
 * phone-shaped run inside one) and leave the halves behind. PII goes before the
 * URL pass, because the URL rewrite percent-encodes the `@` that the email
 * pattern anchors on.
 */
export function sanitizeIntent(value: string): string {
  if (isBinaryBlob(value)) {
    return BINARY_REDACTED_VALUE
  }
  return redactUrls(redactPii(redactCredentials(value)))
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

// A card candidate can span more than one card plus adjacent fields (e.g. an
// expiry, or a second card). This redacts every card in it: scanning
// left-to-right over the whole separator-delimited digit groups, at each start it
// takes the longest run whose joined digits are 13–19 long and pass Luhn, redacts
// just that span, and resumes after it; a group that begins no valid run is kept
// and skipped. Checking group-aligned runs rather than arbitrary digit windows
// keeps the false-positive rate at Luhn's own ~1-in-10, instead of letting a
// chance-valid sub-window of an ordinary long ID trigger redaction.
function redactCardInMatch(match: string): string {
  const groups: { digits: string; start: number; end: number }[] = []
  for (let m = DIGIT_GROUP_PATTERN.exec(match); m !== null; m = DIGIT_GROUP_PATTERN.exec(match)) {
    groups.push({ digits: m[0], start: m.index, end: m.index + m[0].length })
  }
  let output = ''
  let cursor = 0
  let first = 0
  while (first < groups.length) {
    let digits = ''
    let matchedLast = -1
    for (let last = first; last < groups.length; last++) {
      digits += groups[last].digits
      if (digits.length > 19) {
        break
      }
      if (digits.length >= 13 && passesLuhn(digits)) {
        matchedLast = last
      }
    }
    if (matchedLast >= 0) {
      output += match.slice(cursor, groups[first].start) + REDACTED_VALUE
      cursor = groups[matchedLast].end
      first = matchedLast + 1
    } else {
      first++
    }
  }
  return output + match.slice(cursor)
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
  let result = value.replace(UNICODE_SPACE_PATTERN, ' ')
  result = result.replace(EMAIL_PATTERN, REDACTED_VALUE)
  result = result.replace(IPV4_PATTERN, REDACTED_VALUE)
  result = result.replace(IPV6_PATTERN, REDACTED_VALUE)
  result = result.replace(CREDIT_CARD_CANDIDATE_PATTERN, redactCardInMatch)
  result = result.replace(US_SSN_PATTERN, REDACTED_VALUE)
  result = result.replace(PHONE_NANP_PATTERN, REDACTED_VALUE)
  result = result.replace(PHONE_INTL_PATTERN, REDACTED_VALUE)
  return result
}

export function sanitizeCapturedValue(value: unknown): unknown {
  if (value == null) {
    return value
  }

  if (typeof value === 'string') {
    return sanitizeString(value)
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeCapturedValue)
  }

  if (value instanceof Date) {
    return value
  }

  if (typeof value !== 'object') {
    return value
  }

  const result: JsonRecord = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    result[key] = shouldRedactKey(key) ? REDACTED_VALUE : sanitizeCapturedValue(nestedValue)
  }
  return result
}

function buildCapturedMcpArguments(argumentsValue: unknown): unknown {
  if (!isRecord(argumentsValue)) {
    return sanitizeCapturedValue(argumentsValue)
  }

  const capturedArguments: JsonRecord = {}
  for (const [key, value] of Object.entries(argumentsValue)) {
    if (key === CONTEXT_ARGUMENT_NAME) {
      continue
    }
    capturedArguments[key] = sanitizeCapturedValue(value)
  }
  return capturedArguments
}

function buildCapturedMcpParams(params: unknown): unknown {
  if (!isRecord(params)) {
    return sanitizeCapturedValue(params)
  }

  const capturedParams: JsonRecord = {}
  for (const [key, value] of Object.entries(params)) {
    capturedParams[key] = key === 'arguments' ? buildCapturedMcpArguments(value) : sanitizeCapturedValue(value)
  }
  return capturedParams
}

export function buildCapturedMcpParameters(request: unknown): JsonRecord {
  if (!isRecord(request)) {
    return { request: sanitizeCapturedValue(request) }
  }

  const capturedRequest: JsonRecord = {}
  for (const key of ['id', 'jsonrpc', 'method'] as const) {
    if (key in request) {
      capturedRequest[key] = sanitizeCapturedValue(request[key])
    }
  }

  if ('params' in request) {
    capturedRequest.params = buildCapturedMcpParams(request.params)
  }

  return { request: capturedRequest }
}
