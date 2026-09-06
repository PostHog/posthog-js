---
'@posthog/core': minor
'@posthog/browser-common': minor
'posthog-js': minor
'posthog-js-lite': minor
---

Add best-effort in-app browser attribution using `$webview_app` and `$webview_app_version`, without changing existing `$browser` or `$browser_version` values. Detect explicit user-agent markers for Facebook, Facebook Lite, Messenger, Instagram, Threads, LinkedIn, Twitter, TikTok, WhatsApp, Snapchat, WeChat, LINE, Google, Bing, Pinterest, Naver, and KakaoTalk. Unknown apps and versions are omitted; missing markers do not imply a standalone browser.
