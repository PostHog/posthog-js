import { detectWebviewApp } from './webview-app-utils'

const androidUA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36'
const iosUA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'

describe('detectWebviewApp', () => {
  test.each([
    ['Facebook iOS', iosUA + ' [FBIOS;FBAV/440.0.0.35.117;]', 'Facebook', '440.0.0.35.117'],
    ['Facebook Android', androidUA + ' [FBAN/FB4A;FBAV/440.0.0.35.117;]', 'Facebook', '440.0.0.35.117'],
    ['Facebook IAB', androidUA + ' [FB_IAB/FB4A;FBAV/440.0.0.35.117;]', 'Facebook', '440.0.0.35.117'],
    ['Instagram iOS', iosUA + ' Instagram 300.0.0.17.109 (iPhone14,5; iOS 17_1; en_US)', 'Instagram', '300.0.0.17.109'],
    [
      'Instagram Android',
      androidUA + ' Instagram 300.0.0.17.109 Android (33/13; 420dpi)',
      'Instagram',
      '300.0.0.17.109',
    ],
    ['LinkedIn iOS', iosUA + ' [LinkedInApp]', 'LinkedIn', ''],
    ['LinkedIn Android', androidUA + ' LinkedInApp/2.295.106', 'LinkedIn', '2.295.106'],
    ['LinkedIn bracketed version', iosUA + ' [LinkedInApp]/2.295.106', 'LinkedIn', '2.295.106'],
    ['Twitter', iosUA + ' Twitter for iPhone/10.1', 'Twitter', '10.1'],
    ['TikTok', iosUA + ' musical_ly_35.1.0', 'TikTok', '35.1.0'],
    ['WeChat', androidUA + ' MicroMessenger/8.0.40.2420', 'WeChat', '8.0.40.2420'],
    ['LINE', iosUA + ' Line/14.1.0', 'Line', '14.1.0'],
    ['Google iOS', iosUA + ' GSA/315.0.630435', 'Google', '315.0.630435'],
    ['Google Android', androidUA + ' GSA/15.1.2.28.arm64', 'Google', '15.1.2.28'],
    ['Pinterest iOS', iosUA + ' [Pinterest/iOS]', 'Pinterest', ''],
    ['Pinterest Android', androidUA + ' [Pinterest/Android]', 'Pinterest', ''],
    ['Facebook without version', iosUA + ' [FBIOS]', 'Facebook', ''],
    ['Instagram without version', iosUA + ' Instagram', 'Instagram', ''],
    [
      'Instagram with Facebook markers',
      iosUA + ' Instagram 300.0.0 [FBAN/Instagram;FBAV/1.0;]',
      'Instagram',
      '300.0.0',
    ],
    ['Facebook malformed version', iosUA + ' [FBIOS;FBAV/unknown;]', 'Facebook', ''],
  ])('detects %s', (_name, userAgent, app, version) => {
    expect(detectWebviewApp(userAgent)).toEqual([app, version])
  })

  // Marker/version combinations from upstream fixtures, using the common browser
  // prefixes above. These are UA facts, not imported parser rules or dependencies:
  // https://github.com/faisalman/ua-parser-js/blob/61515039822d0a451837e7871537562b8f9804cb/test/data/ua/browser/browser-all.json
  // https://github.com/matomo-org/device-detector/blob/5a6f5d0184b5a867c1db9c0733f6b89686c5c47b/regexes/client/mobile_apps.yml
  test.each([
    ['TikTok trill iOS', iosUA + ' trill_43.0.0 BytedanceWebview/d8a21c6', 'TikTok', '43.0.0'],
    [
      'TikTok build number',
      androidUA + ' musical_ly_2022803040 AppName/musical_ly app_version/28.3.4',
      'TikTok',
      '28.3.4',
    ],
    [
      'TikTok trill build number',
      androidUA + ' trill_2022109040 AppName/musical_ly app_version/21.9.4',
      'TikTok',
      '21.9.4',
    ],
    ['TikTok trill app name', androidUA + ' AppName/trill app_version/21.9.4', 'TikTok', '21.9.4'],
    ['TikTok explicit version wins', androidUA + ' musical_ly_28.0.0 app_version/28.3.4', 'TikTok', '28.3.4'],
    ['TikTok build only', androidUA + ' musical_ly_2022803040', 'TikTok', ''],
    ['TikTok malformed explicit version', iosUA + ' trill_43.0.0 app_version/unknown', 'TikTok', '43.0.0'],
    ['Twitter Android', androidUA + ' TwitterAndroid', 'Twitter', ''],
    ['Twitter Android version', androidUA + ' TwitterAndroid/10.34', 'Twitter', '10.34'],
    ['WhatsApp Android', androidUA + ' WA4A/2.26.30.97', 'WhatsApp', '2.26.30.97'],
    ['WhatsApp iOS', iosUA + ' [WAiOS/2.26.31]', 'WhatsApp', '2.26.31'],
    ['Snapchat', iosUA + ' Snapchat/12.33.0.36 (like Safari/8614.1.25.0.31, panda)', 'Snapchat', '12.33.0.36'],
    ['Bing iOS', iosUA + ' BingSapphire/31.8.430522001', 'Bing', '31.8.430522001'],
    ['Bing Android', androidUA + ' BingWeb/6.9.12', 'Bing', '6.9.12'],
    ['Messenger iOS', iosUA + ' [FBAN/MessengerForiOS;FBAV/132.0.0.41.90;]', 'Messenger', '132.0.0.41.90'],
    ['Messenger Android', androidUA + ' [FBAN/Orca-Android;FBAV/440.0.0;]', 'Messenger', '440.0.0'],
    ['Messenger Android IAB', androidUA + ' [FB_IAB/Orca-Android;FBAV/440.0.0;]', 'Messenger', '440.0.0'],
    ['Messenger before Facebook', iosUA + ' [FBIOS;FBAN/MessengerForiOS;FBAV/132.0.0;]', 'Messenger', '132.0.0'],
    ['Messenger without version', iosUA + ' [FBAN/MessengerForiOS;]', 'Messenger', ''],
    ['Facebook Lite', androidUA + ' [FBAN/EMA;FBAV/440.0.0;]', 'Facebook Lite', '440.0.0'],
    ['Threads', iosUA + ' Barcelona/300.0.0.17.109', 'Threads', '300.0.0.17.109'],
    ['WeChat alternative', iosUA + ' WeChat/8.0.40', 'WeChat', '8.0.40'],
    ['Pinterest iOS version', iosUA + ' Pinterest for iOS/7.11 (iPhone7,2; 12.1.4)', 'Pinterest', '7.11'],
    ['Pinterest Android version', androidUA + ' Pinterest for Android/9.0.4 (K83CA; 9)', 'Pinterest', '9.0.4'],
    ['Pinterest tablet version', androidUA + ' Pinterest for Android Tablet/9.0.4', 'Pinterest', '9.0.4'],
    ['Pinterest version', iosUA + ' Pinterest/9.0.4', 'Pinterest', '9.0.4'],
    ['Naver Android', androidUA + ' NAVER(inapp; search; 1010; 11.11.2)', 'Naver', '11.11.2'],
    ['Naver iOS', iosUA + ' NAVER(inapp; search; 720; 10.25.0; 11PRO)', 'Naver', '10.25.0'],
    ['KakaoTalk iOS', iosUA + ' BizWebView KAKAOTALK 9.7.6', 'KakaoTalk', '9.7.6'],
    ['KakaoTalk Android build only', androidUA + ';KAKAOTALK 2409760', 'KakaoTalk', ''],
    ['KakaoTalk slash version', iosUA + ' KakaoTalk/9.7.6', 'KakaoTalk', '9.7.6'],
  ])('detects additional marker: %s', (_name, userAgent, app, version) => {
    expect(detectWebviewApp(userAgent)).toEqual([app, version])
  })

  test.each([
    '',
    androidUA, // A generic WebView does not identify its host app.
    iosUA,
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    iosUA + ' Version/17.1 Safari/604.1',
    'Mozilla/5.0 (compatible; Pinterestbot/1.0; +http://www.pinterest.com/bot.html)',
    'LinkedInBot/1.0',
    'Twitterbot/1.0',
    'facebookexternalhit/1.1',
    'WhatsApp/2.26.31', // Generic WhatsApp UAs can be link-preview requests.
    'bingbot/2.0',
    androidUA + ' BytedanceWebview/d8a21c6', // Shared engine, not a TikTok app marker.
    androidUA + ' app_version/28.3.4',
    androidUA + ' NotSnapchat/1.0',
    androidUA + ' NotWA4A/1.0',
    androidUA + ' NotBingWeb/1.0',
    androidUA + ' NAVER(inapp; naverdicapp; 1; 2.0)', // A different Naver app.
    androidUA + ' WeChatShareExtensionNew/8.0.40',
    androidUA + ' NotInstagram/1.0',
    androidUA + ' NotLine/1.0',
  ])('does not infer a host app from %s', (userAgent) => {
    expect(detectWebviewApp(userAgent)).toEqual(['', ''])
  })
})
