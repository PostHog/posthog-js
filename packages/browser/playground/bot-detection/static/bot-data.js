// Categorized bot data from PostHog's blocked-uas.ts
window.BOT_CATEGORIES = {
    'Search Engines': [
        {
            name: 'Googlebot',
            pattern: 'googlebot',
            example: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        },
        {
            name: 'Bingbot',
            pattern: 'bingbot',
            example: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
        },
        {
            name: 'DuckDuckBot',
            pattern: 'duckduckbot',
            example: 'DuckDuckBot/1.0; (+http://duckduckgo.com/duckduckbot.html)',
        },
        {
            name: 'Baiduspider',
            pattern: 'baiduspider',
            example: 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
        },
        {
            name: 'Yandex',
            pattern: 'yandexbot',
            example: 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
        },
        {
            name: 'Yahoo Slurp',
            pattern: 'yahoo! slurp',
            example: 'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)',
        },
        {
            name: 'Applebot',
            pattern: 'applebot',
            example:
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) AppleWebKit/600.2.5 (KHTML, like Gecko) Version/8.0.2 Safari/600.2.5 (Applebot/0.1)',
        },
    ],
    'Social Media': [
        { name: 'Facebook', pattern: 'facebookexternal', example: 'facebookexternalagent' },
        {
            name: 'Meta External Agent',
            pattern: 'meta-externalagent',
            example:
                'Mozilla/5.0 (compatible; Meta-ExternalAgent/1.1; +https://developers.facebook.com/docs/sharing/webmasters/crawler)',
        },
        { name: 'Twitter', pattern: 'twitterbot', example: 'Twitterbot/1.0' },
        {
            name: 'LinkedIn',
            pattern: 'linkedinbot',
            example: 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
        },
        { name: 'Pinterest', pattern: 'pinterest', example: 'Pinterest/0.2 (+http://www.pinterest.com/)' },
        {
            name: 'Slackbot',
            pattern: 'slackbot',
            example: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
        },
    ],
    'SEO Tools': [
        {
            name: 'Ahrefs Bot',
            pattern: 'ahrefsbot',
            example: 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
        },
        { name: 'Ahrefs Site Audit', pattern: 'ahrefssiteaudit', example: 'AhrefsSiteAudit/6.1' },
        {
            name: 'Semrush',
            pattern: 'semrushbot',
            example: 'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
        },
        { name: 'Screaming Frog', pattern: 'screaming frog', example: 'Screaming Frog SEO Spider/16.0' },
        { name: 'Sitebulb', pattern: 'sitebulb', example: 'Sitebulb/1.0.0 (https://sitebulb.com/)' },
        {
            name: 'MJ12bot',
            pattern: 'mj12bot',
            example: 'Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)',
        },
        {
            name: 'Rogerbot',
            pattern: 'rogerbot',
            example: 'rogerbot/1.0 (http://www.moz.com/dp/rogerbot, rogerbot-crawler+shiny@moz.com)',
        },
        {
            name: 'DataForSEO',
            pattern: 'dataforseobot',
            example: 'Mozilla/5.0 (compatible; DataForSeoBot/1.0; +https://dataforseo.com/dataforseo-bot)',
        },
    ],
    'AI Crawlers': [
        {
            name: 'GPTbot (OpenAI)',
            pattern: 'gptbot',
            example: 'Mozilla/5.0 (compatible; GPTbot/1.1; +https://openai.com/gptbot)',
        },
        {
            name: 'ChatGPT-User',
            pattern: 'chatgpt-user',
            example:
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15 (ChatGPT-User/1.0)',
        },
        { name: 'Perplexity', pattern: 'perplexitybot', example: 'PerplexityBot/1.0 (+http://www.perplexity.ai/bot)' },
        { name: 'Google Cloud Vertex', pattern: 'google-cloudvertexbot', example: 'Google-CloudVertexBot' },
        { name: 'Claude Bot', pattern: 'claude-web', example: 'Claude-Web/1.0' },
        {
            name: 'ByteSpider (TikTok)',
            pattern: 'bytespider',
            example:
                'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
        },
    ],
    'Development & Testing': [
        {
            name: 'Headless Chrome',
            pattern: 'headlesschrome',
            example:
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/91.0.4472.124 Safari/537.36',
        },
        {
            name: 'Cypress',
            pattern: 'cypress',
            example:
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Cypress/12.0.0 Chrome/106.0.0.0 Safari/537.36',
        },
        {
            name: 'Chrome Lighthouse',
            pattern: 'chrome-lighthouse',
            example:
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Chrome-Lighthouse',
        },
        { name: 'Vercel Bot', pattern: 'vercelbot', example: 'vercelbot' },
        {
            name: 'Prerender',
            pattern: 'prerender',
            example:
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Prerender (+https://github.com/prerender/prerender)',
        },
    ],
    'Uptime Monitoring': [
        {
            name: 'UptimeRobot',
            pattern: 'uptimerobot',
            example: 'Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)',
        },
        { name: 'Sentry Uptime', pattern: 'sentryuptimebot', example: 'SentryUptimeBot/1.0 (+http://sentry.io/)' },
        {
            name: 'Better Uptime',
            pattern: 'better uptime bot',
            example:
                'Better Uptime Bot Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.169 Safari/537.36',
        },
    ],
    'Other Crawlers': [
        {
            name: 'Archive.org',
            pattern: 'archive.org_bot',
            example: 'Mozilla/5.0 (compatible; archive.org_bot +http://archive.org/details/archive.org_bot)',
        },
        { name: 'HubSpot', pattern: 'hubspot', example: 'HubSpot Links Crawler 2.0' },
        {
            name: 'PetalBot (Huawei)',
            pattern: 'petalbot',
            example:
                'Mozilla/5.0 (Linux; Android 7.0;) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)',
        },
        {
            name: 'Amazonbot',
            pattern: 'amazonbot',
            example:
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) AppleWebKit/600.2.5 (KHTML, like Gecko) Version/8.0.2 Safari/600.2.5 (Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)',
        },
    ],
}
