import { each } from './'

import { isArray, isFile, isUndefined } from '@posthog/core'
import { logger } from './logger'
import { document } from './globals'

const localDomains = ['localhost', '127.0.0.1']

/**
 * IE11 doesn't support `new URL`
 * so we can create an anchor element and use that to parse the URL
 * there's a lot of overlap between HTMLHyperlinkElementUtils and URL
 * meaning useful properties like `pathname` are available on both
 */
export const convertToURL = (url: string): HTMLAnchorElement | null => {
    const location = document?.createElement('a')
    if (isUndefined(location)) {
        return null
    }

    location.href = url
    return location
}

export const formDataToQuery = function (formdata: Record<string, any> | FormData, arg_separator = '&'): string {
    let use_val: string
    let use_key: string
    const tph_arr: string[] = []

    each(formdata, function (val: File | string | undefined, key: string | undefined) {
        // the key might be literally the string undefined for e.g. if {undefined: 'something'}
        if (isUndefined(val) || isUndefined(key) || key === 'undefined') {
            return
        }

        use_val = encodeURIComponent(isFile(val) ? val.name : val.toString())
        use_key = encodeURIComponent(key)
        tph_arr[tph_arr.length] = use_key + '=' + use_val
    })

    return tph_arr.join(arg_separator)
}

/**
 * Recursively decodes a URL-encoded string up to 5 levels deep.
 * Also replaces '+' characters with spaces (common in query strings).
 * 
 * @param str - The encoded string to decode
 * @returns The fully decoded string
 */
function deepDecode(str: string): string {
  if (!str || typeof str !== "string") return "";

  let current = str;

  // Decode up to 5 times in case of multiple levels of encoding
  for (let i = 0; i < 5; i++) {
    try {
      const decoded = decodeURIComponent(current);
      // If decoding didn't change the string, we're done
      if (decoded === current) break;
      current = decoded;
    } catch (e) {
      // If decoding fails (malformed string), stop trying
      break;
    }
  }

  // Replace '+' with space (URL query string convention)
  return current.replace(/\+/g, " ");
}

/**
 * Checks if a string contains nested query parameters and parses them.
 * Returns null if the string is not a valid query string format.
 * 
 * @param str - The string to check for query parameters
 * @returns Object with key-value pairs or null if not a query string
 */
function parsePossibleQueryString(str: string): Record<string, string> | null {
  if (!str || typeof str !== "string") return null;
  if (!str.includes("=")) return null;

  const parts = str.split("&");
  
  // Check if at least one part contains "=" (valid query param format)
  const hasQueryParam = parts.some((p) => p.includes("="));
  if (!hasQueryParam) return null;

  try {
    const obj: Record<string, string> = {};
    // Manually parse each key=value pair
    for (let i = 0; i < parts.length; i++) {
      const pair = parts[i];
      const eqIndex = pair.indexOf("=");
      if (eqIndex > -1) {
        const key = pair.substring(0, eqIndex);
        const value = pair.substring(eqIndex + 1);
        if (!(key in obj)) {
          obj[key] = value;
        }
      }
    }
    return Object.keys(obj).length > 0 ? obj : null;
  } catch (e) {
    return null;
  }
}

/**
 * Recursively extracts all query parameters, including nested ones.
 * When a parameter value contains encoded query params, it extracts both
 * the initial value and the nested parameters.
 * 
 * Example: utm_source=google%26utm_medium%3Dcpc
 * Results in: { utm_source: "google", utm_medium: "cpc" }
 * 
 * @param obj - Object containing raw parameter key-value pairs
 * @param finalParams - Accumulator object for all extracted parameters
 */
function extractParams(
  obj: Record<string, string>,
  finalParams: Record<string, string>
): void {
  for (const key in obj) {
    if (!obj.hasOwnProperty(key)) continue;

    const rawValue = obj[key] || "";
    
    // Decode one level to check for nested parameters
    let decoded = "";
    try {
      decoded = decodeURIComponent(rawValue);
    } catch (e) {
      decoded = rawValue;
    }
    
    // Check if this decoded value contains nested query parameters
    const nested = parsePossibleQueryString(decoded);

    if (nested) {
      // Extract the part before the nested params as the value for current key
      const firstPart = decoded.split("&")[0];
      
      // Only assign if there's a meaningful value (not another key=value pair)
      if (firstPart && !firstPart.includes("=") && !(key in finalParams)) {
        finalParams[key] = deepDecode(firstPart);
      }

      // Recursively extract the nested parameters
      extractParams(nested, finalParams);
      continue;
    }

    // No nested params - just decode and assign the value
    if (!(key in finalParams)) {
      finalParams[key] = deepDecode(rawValue);
    }
  }
}

/**
 * Extracts all query parameters from a URL, including deeply nested ones.
 * Handles cases where parameter values contain encoded query strings.
 * 
 * Example:
 * Input: "http://example.com/?utm_source=google%26utm_medium%3Dcpc"
 * Output: { utm_source: "google", utm_medium: "cpc" }
 * 
 * @param rawUrl - The full URL to parse
 * @returns Object containing all extracted query parameters
 */
export function getAllParams(rawUrl: string): Record<string, string> {
  try {
    // Remove hash fragment from URL
    const cleanedUrl = (rawUrl || "").split("#")[0];
    // Extract query string without using URL API (IE11 compatible)
    // Find the query string (after '?')
    const qIndex = cleanedUrl.indexOf("?");
    const queryString = qIndex === -1 ? "" : cleanedUrl.substring(qIndex + 1);
    
    // Manually parse query string to keep values encoded
    // (URLSearchParams would auto-decode, breaking nested param detection)
    const top: Record<string, string> = {};
    if (queryString) {
      const pairs = queryString.split("&");
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const eqIndex = pair.indexOf("=");
        if (eqIndex > -1) {
          const key = pair.substring(0, eqIndex);
          const value = pair.substring(eqIndex + 1);
          if (!(key in top)) {
            top[key] = value; // Keep value encoded for nested param detection
          }
        }
      }
    }

    // Extract all parameters including nested ones
    const finalParams: Record<string, string> = {};
    extractParams(top, finalParams);

    return finalParams;
  } catch (e) {
    // Return empty object if URL parsing fails
    return {};
  }
}

export const getQueryParam = function (url: string, param: string): string {
    // now this can handle nested encoded urls like "http://example.com/?utm_source=google%26utm_medium%3Dcpc%26utm_term%3Dexample%20store"
    // get all params and return the needed one
    if (!param) return "";
    return getAllParams(url)?.[param] || "";
}

// replace any query params in the url with the provided mask value. Tries to keep the URL as instant as possible,
// including preserving malformed text in most cases
export const maskQueryParams = function <T extends string | undefined>(
    url: T,
    maskedParams: string[] | undefined,
    mask: string
): T extends string ? string : undefined {
    if (!url || !maskedParams || !maskedParams.length) {
        return url as any
    }

    const splitHash = url.split('#')
    const withoutHash: string = splitHash[0] || ''
    const hash = splitHash[1]

    const splitQuery: string[] = withoutHash.split('?')
    const queryString: string = splitQuery[1]
    const urlWithoutQueryAndHash: string = splitQuery[0]
    const queryParts = (queryString || '').split('&')

    // use an array of strings rather than an object to preserve ordering and duplicates
    const paramStrings: string[] = []

    for (let i = 0; i < queryParts.length; i++) {
        const keyValuePair = queryParts[i].split('=')
        if (!isArray(keyValuePair)) {
            continue
        } else if (maskedParams.includes(keyValuePair[0])) {
            paramStrings.push(keyValuePair[0] + '=' + mask)
        } else {
            paramStrings.push(queryParts[i])
        }
    }

    let result = urlWithoutQueryAndHash
    if (queryString != null) {
        result += '?' + paramStrings.join('&')
    }
    if (hash != null) {
        result += '#' + hash
    }

    return result as any
}

export const _getHashParam = function (hash: string, param: string): string | null {
    const matches = hash.match(new RegExp(param + '=([^&]*)'))
    return matches ? matches[1] : null
}

export const isLocalhost = (): boolean => {
    return localDomains.includes(location.hostname)
}
