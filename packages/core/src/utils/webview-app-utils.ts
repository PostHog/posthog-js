// App markers must be checked independently of browser detection: the host app
// and the browser rendering its webview are separate dimensions.
const facebookAppVersion = /\bFBAV\/(\d+(?:\.\d+)*)/i
const webviewAppMatchers: [RegExp, string, RegExp?][] = [
  [/\bInstagram(?:[ /](\d+(?:\.\d+)*))?\b/i, 'Instagram'],
  [/\bBarcelona[ /](\d+(?:\.\d+)*)?/i, 'Threads'],
  // Specific Meta apps must precede Facebook, which can share their markers.
  [/\b(?:MessengerForiOS|(?:FBAN|FB_IAB)\/Orca-Android)\b/i, 'Messenger', facebookAppVersion],
  [/\bFBAN\/EMA\b/i, 'Facebook Lite', facebookAppVersion],
  [/\b(?:FBIOS|(?:FBAN|FB_IAB)\/(?:FB4A|FBIOS))\b/i, 'Facebook', facebookAppVersion],
  [/\bLinkedInApp(?:\]?\/(\d+(?:\.\d+)*))?\b/i, 'LinkedIn'],
  [/\bTwitter(?:Android| for (?:iPhone|iPad|Android))(?:\/(\d+(?:\.\d+)*))?\b/i, 'Twitter'],
  // Android's musical_ly_/trill_ suffix can be a build number. Prefer the
  // explicit app_version token, and only use a dotted suffix as a fallback.
  [/\b(?:musical_ly|trill)(?:[_/](\d+\.\d+(?:\.\d+)*))?(?=\b|_)/i, 'TikTok', /\bapp_version\/(\d+(?:\.\d+)*)/i],
  [/\b(?:MicroMessenger|WeChat)\/(\d+(?:\.\d+)*)?/i, 'WeChat'],
  [/\bLine\/(\d+(?:\.\d+)*)?/i, 'Line'],
  [/\bGSA\/(\d+(?:\.\d+)*)?/i, 'Google'],
  [/\[Pinterest\/(?:iOS|Android)\b|\bPinterest(?: for (?:Android(?: Tablet)?|iOS))?\/(\d+(?:\.\d+)*)/i, 'Pinterest'],
  // Generic WhatsApp/ UAs can be link previews, not an embedded browser.
  [/\b(?:WA4A|WAiOS)\/(\d+(?:\.\d+)*)?/i, 'WhatsApp'],
  [/\bSnapchat[ /](\d+(?:\.\d+)*)?/i, 'Snapchat'],
  [/\bBing(?:Web|Sapphire)\/(\d+(?:\.\d+)*)?/i, 'Bing'],
  [/\bNAVER\(inapp; search;/i, 'Naver', /\bNAVER\(inapp; search;[^;)]*; (\d+(?:\.\d+)*)/i],
  // KakaoTalk also emits integer build identifiers, not dotted app versions.
  [/\bKAKAOTALK[ /](\d+\.\d+(?:\.\d+)*)?/i, 'KakaoTalk'],
]

/**
 * Best-effort detection of the app hosting a webview from explicit User-Agent
 * markers. Some apps use the same UA as a standalone browser, so no match means
 * unknown, not that this is definitely NOT an in-app browser. A generic Android
 * `wv` marker alone cannot identify the host app. Never infer it from a referrer.
 *
 * Returns [app name, app version], using empty strings for unknown values. Only
 * explicit app versions are returned, as strings to preserve all components;
 * browser/OS versions are not substitutes for a missing app version.
 */
export function detectWebviewApp(userAgent: string): [string, string] {
  for (let i = 0; i < webviewAppMatchers.length; i++) {
    const [regex, name, versionRegex] = webviewAppMatchers[i]
    const match = userAgent.match(regex)
    if (match) {
      const versionMatch = (versionRegex && userAgent.match(versionRegex)) || match
      return [name, versionMatch?.[1] || '']
    }
  }
  return ['', '']
}
