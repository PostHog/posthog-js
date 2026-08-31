import { currentTimestamp, detectBrowser, detectBrowserVersion, stripUrlHash } from '@posthog/core'
import { version } from './version'

export function getContext(window: Window | undefined, disableCaptureUrlHashes: boolean = false): any {
  let context = {}
  if (window?.navigator) {
    const userAgent = window.navigator.userAgent
    const osValue = os(window)
    context = {
      ...context,
      ...(osValue !== undefined && { $os: osValue }),
      $browser: detectBrowser(userAgent, window.navigator.vendor),
      $referrer: window.document.referrer,
      $referring_domain: referringDomain(window.document.referrer),
      $device: device(userAgent),
      $current_url: disableCaptureUrlHashes ? stripUrlHash(window.location.href) : window.location.href,
      $host: window.location.host,
      $pathname: window.location.pathname,
      $browser_version: detectBrowserVersion(userAgent, window.navigator.vendor),
      $screen_height: window.screen.height,
      $screen_width: window.screen.width,
      $screen_dpr: window.devicePixelRatio,
    }
  }

  context = {
    ...context,
    $lib: 'js',
    $lib_version: version,
    $insert_id: Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10),
    $time: currentTimestamp() / 1000, // epoch time in seconds
  }
  return context // TODO: strip empty props?
}

function os(window: Window | undefined): string | undefined {
  if (!window?.navigator) {
    return undefined
  }
  const a = window.navigator.userAgent
  if (/Windows/i.test(a)) {
    if (/Phone/.test(a) || /WPDesktop/.test(a)) {
      return 'Windows Phone'
    }
    return 'Windows'
  } else if (/(iPhone|iPad|iPod)/.test(a)) {
    return 'iOS'
  } else if (/Android/.test(a)) {
    return 'Android'
  } else if (/(BlackBerry|PlayBook|BB10)/i.test(a)) {
    return 'BlackBerry'
  } else if (/Mac/i.test(a)) {
    return 'Mac OS X'
  } else if (/Linux/.test(a)) {
    return 'Linux'
  } else if (/CrOS/.test(a)) {
    return 'Chrome OS'
  } else {
    return undefined
  }
}

function device(userAgent: string): string {
  if (/Windows Phone/i.test(userAgent) || /WPDesktop/.test(userAgent)) {
    return 'Windows Phone'
  } else if (/iPad/.test(userAgent)) {
    return 'iPad'
  } else if (/iPod/.test(userAgent)) {
    return 'iPod Touch'
  } else if (/iPhone/.test(userAgent)) {
    return 'iPhone'
  } else if (/(BlackBerry|PlayBook|BB10)/i.test(userAgent)) {
    return 'BlackBerry'
  } else if (/Android/.test(userAgent)) {
    return 'Android'
  } else {
    return ''
  }
}

function referringDomain(referrer: string): string {
  const split = referrer.split('/')
  if (split.length >= 3) {
    return split[2]
  }
  return ''
}
