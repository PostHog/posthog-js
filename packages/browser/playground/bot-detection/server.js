require('dotenv').config()
const express = require('express')
const path = require('path')
const app = express()
const PORT = 8080

const removeTrailingSlash = (str) => str.replace(/\/$/, '')

// Environment variables (with fallbacks for local development)
const POSTHOG_TOKEN = process.env.POSTHOG_TOKEN || 'test-key'
const POSTHOG_API_HOST = removeTrailingSlash(process.env.POSTHOG_API_HOST || 'https://us.i.posthog.com')
const POSTHOG_UI_HOST = removeTrailingSlash(process.env.POSTHOG_UI_HOST || POSTHOG_API_HOST)

// Serve the built PostHog library from the parent directory
app.use('/posthog', express.static(path.join(__dirname, '../../dist')))

// Categorized bot data from PostHog's blocked-uas.ts
const BOT_CATEGORIES = {
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

// Home page with bot detection testing UI
app.get('/', (req, res) => {
    const userAgent = req.headers['user-agent'] || 'No User Agent'

    // Generate bot selector options HTML
    let botOptionsHTML = '<option value="">-- Select a Bot --</option>'
    for (const [category, bots] of Object.entries(BOT_CATEGORIES)) {
        botOptionsHTML += `<optgroup label="${category}">`
        bots.forEach((bot) => {
            botOptionsHTML += `<option value="${bot.example}" data-pattern="${bot.pattern}">${bot.name}</option>`
        })
        botOptionsHTML += '</optgroup>'
    }
    botOptionsHTML += '<option value="custom">✏️ Custom User Agent...</option>'

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Bot Detection Playground</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
          line-height: 1.6;
          color: #333;
          background: #f8f9fa;
        }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 20px;
          text-align: center;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header h1 {
          font-size: 28px;
          margin-bottom: 5px;
        }
        .header p {
          opacity: 0.9;
          font-size: 14px;
        }
        .container {
          display: flex;
          gap: 20px;
          padding: 20px;
          max-width: 1600px;
          margin: 0 auto;
          min-height: calc(100vh - 100px);
        }
        .left-column {
          flex: 0 0 35%;
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        .right-column {
          flex: 0 0 65%;
          display: flex;
          flex-direction: column;
        }
        .card {
          background: white;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
        .card h2 {
          font-size: 18px;
          margin-bottom: 15px;
          color: #2d3748;
          border-bottom: 2px solid #e2e8f0;
          padding-bottom: 8px;
        }
        .card h3 {
          font-size: 16px;
          margin-bottom: 10px;
          color: #4a5568;
        }
        .ua-display {
          background: #f7fafc;
          padding: 12px;
          border-radius: 6px;
          border-left: 3px solid #667eea;
          font-family: 'Courier New', monospace;
          font-size: 12px;
          word-break: break-all;
          line-height: 1.5;
          color: #2d3748;
        }
        select {
          width: 100%;
          padding: 10px;
          border: 2px solid #e2e8f0;
          border-radius: 6px;
          font-size: 14px;
          background: white;
          cursor: pointer;
          transition: border-color 0.2s;
        }
        select:hover {
          border-color: #cbd5e0;
        }
        select:focus {
          outline: none;
          border-color: #667eea;
        }
        .button-group {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        button {
          padding: 12px 20px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          border: none;
          border-radius: 6px;
          color: white;
          transition: all 0.2s;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        button:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        button:active {
          transform: translateY(0);
        }
        .btn-primary { background: #3182ce; }
        .btn-primary:hover { background: #2c5aa0; }
        .btn-success { background: #38a169; }
        .btn-success:hover { background: #2f855a; }
        .btn-purple { background: #805ad5; }
        .btn-purple:hover { background: #6b46c1; }
        .status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 6px 12px;
          border-radius: 20px;
          font-weight: 600;
          font-size: 13px;
        }
        .status.enabled { background: #c6f6d5; color: #22543d; }
        .status.disabled { background: #fed7d7; color: #742a2a; }
        .event-log {
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
          display: flex;
          flex-direction: column;
          height: calc(100vh - 140px);
        }
        .event-log-header {
          padding: 15px 20px;
          border-bottom: 2px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #f7fafc;
          border-radius: 8px 8px 0 0;
        }
        .event-log-title {
          font-size: 18px;
          font-weight: 600;
          color: #2d3748;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .event-count {
          background: #667eea;
          color: white;
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
        }
        .event-log-controls {
          display: flex;
          gap: 10px;
        }
        .btn-small {
          padding: 6px 12px;
          font-size: 12px;
          border-radius: 4px;
          background: #e2e8f0;
          color: #2d3748;
          border: none;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-small:hover {
          background: #cbd5e0;
        }
        .btn-small.active {
          background: #667eea;
          color: white;
        }
        .event-log-content {
          flex: 1;
          overflow-y: auto;
          padding: 15px;
          background: #ffffff;
        }
        .event-log-empty {
          text-align: center;
          padding: 60px 20px;
          color: #a0aec0;
        }
        .event-log-empty-icon {
          font-size: 48px;
          margin-bottom: 10px;
        }
        .event-card {
          background: #f7fafc;
          border-left: 4px solid #cbd5e0;
          padding: 12px;
          margin-bottom: 10px;
          border-radius: 4px;
          transition: all 0.2s;
        }
        .event-card:hover {
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          transform: translateX(2px);
        }
        .event-card.pageview {
          border-left-color: #3182ce;
          background: #ebf8ff;
        }
        .event-card.bot-pageview {
          border-left-color: #ed8936;
          background: #fffaf0;
        }
        .event-card.custom {
          border-left-color: #38a169;
          background: #f0fff4;
        }
        .event-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .event-name {
          font-weight: 600;
          font-size: 14px;
          font-family: 'Courier New', monospace;
        }
        .event-name.pageview { color: #2c5aa0; }
        .event-name.bot-pageview { color: #c05621; }
        .event-name.custom { color: #2f855a; }
        .event-timestamp {
          font-size: 11px;
          color: #718096;
          font-family: 'Courier New', monospace;
        }
        .event-properties {
          font-size: 12px;
          color: #4a5568;
          font-family: 'Courier New', monospace;
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.3s ease;
        }
        .event-properties.expanded {
          max-height: 500px;
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid #e2e8f0;
        }
        .event-property {
          margin: 3px 0;
        }
        .event-property-key {
          color: #805ad5;
          font-weight: 600;
        }
        .event-toggle {
          cursor: pointer;
          color: #667eea;
          font-size: 11px;
          font-weight: 600;
          text-decoration: underline;
        }
        .event-toggle:hover {
          color: #5a67d8;
        }
        .instructions {
          font-size: 13px;
          line-height: 1.7;
        }
        .instructions ol {
          margin-left: 20px;
        }
        .instructions li {
          margin: 8px 0;
        }
        .instructions code {
          background: #edf2f7;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 12px;
        }
        .info-badge {
          background: #bee3f8;
          color: #2c5aa0;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 12px;
          margin-top: 10px;
        }
        @media (max-width: 1200px) {
          .container { flex-direction: column; }
          .left-column, .right-column { flex: 1 1 100%; }
          .event-log { height: 500px; }
        }
      </style>
      <script src="/posthog/array.js"></script>
      <script>
        // Event storage
        window.capturedEvents = [];
        let autoScroll = true;
        let eventIdCounter = 0;

        // User agent override for testing bot detection
        let userAgentOverride = null;
        let selectedBotName = null;

        // Initialize PostHog
        posthog.init("${POSTHOG_TOKEN}", {
          api_host: "${POSTHOG_API_HOST}",
          ui_host: "${POSTHOG_UI_HOST}",
          __preview_send_bot_pageviews: true,
          autocapture: false,
          before_send: function(event) {
            // Override user agent if one is selected
            if (userAgentOverride) {
              event.properties.$raw_user_agent = userAgentOverride;
            }
            return event;
          },
          loaded: function(ph) {
            console.log('PostHog loaded successfully!');
            ph.debug();

            // Monkey-patch capture to intercept all events
            const originalCapture = ph.capture.bind(ph);
            ph.capture = function(eventName, properties, options) {
              const eventData = {
                id: ++eventIdCounter,
                timestamp: new Date(),
                event: eventName,
                properties: properties || {},
                options: options || {}
              };

              window.capturedEvents.push(eventData);
              if (window.capturedEvents.length > 100) {
                window.capturedEvents.shift(); // Keep max 100 events
              }

              displayEventInLog(eventData);
              return originalCapture(eventName, properties, options);
            };
          }
        });

        function displayEventInLog(eventData) {
          const logContent = document.getElementById('event-log-content');
          const emptyState = document.getElementById('empty-state');

          if (emptyState) {
            emptyState.remove();
          }

          // Determine event type for styling
          let eventType = 'custom';
          let eventClass = 'custom';
          if (eventData.event === '$pageview') {
            eventType = 'pageview';
            eventClass = 'pageview';
          } else if (eventData.event === '$bot_pageview') {
            eventType = 'bot-pageview';
            eventClass = 'bot-pageview';
          }

          // Format timestamp
          const time = eventData.timestamp.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3
          });

          // Build properties JSON with bot properties first
          const botProps = ['$browser_type', '$raw_user_agent'];
          const orderedProps = {};

          // Add bot properties first (if they exist)
          botProps.forEach(key => {
            if (eventData.properties[key] !== undefined) {
              orderedProps[key] = eventData.properties[key];
            }
          });

          // Add all other properties
          Object.keys(eventData.properties).forEach(key => {
            if (!botProps.includes(key)) {
              orderedProps[key] = eventData.properties[key];
            }
          });

          // Format as JSON with bot properties highlighted
          let propsHTML = '<pre style="margin: 0; font-family: monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all;">';
          propsHTML += '{\\n';
          const propKeys = Object.keys(orderedProps);
          propKeys.forEach((key, idx) => {
            const value = JSON.stringify(orderedProps[key]);
            const isBotProp = botProps.includes(key);
            const comma = idx < propKeys.length - 1 ? ',' : '';

            if (isBotProp) {
              propsHTML += '  <strong style="color: #e53e3e;">"' + key + '"</strong>: ' + value + comma + '\\n';
            } else {
              propsHTML += '  "' + key + '": ' + value + comma + '\\n';
            }
          });
          propsHTML += '}</pre>';

          const eventCard = document.createElement('div');
          eventCard.className = 'event-card ' + eventClass;
          eventCard.innerHTML = '<div class="event-header">' +
            '<span class="event-name ' + eventClass + '">' + eventData.event + '</span>' +
            '<span class="event-timestamp">' + time + '</span>' +
            '</div>' +
            '<span class="event-toggle" onclick="toggleEventProps(' + eventData.id + ')">Show properties ▼</span>' +
            '<div class="event-properties" id="props-' + eventData.id + '">' +
              propsHTML +
            '</div>';

          logContent.appendChild(eventCard);
          updateEventCount();

          if (autoScroll) {
            logContent.scrollTop = logContent.scrollHeight;
          }
        }

        window.toggleEventProps = function(id) {
          const propsEl = document.getElementById('props-' + id);
          propsEl.classList.toggle('expanded');
        };

        function updateEventCount() {
          document.getElementById('event-count').textContent = window.capturedEvents.length;
        }

        window.clearEventLog = function() {
          window.capturedEvents = [];
          const logContent = document.getElementById('event-log-content');
          logContent.innerHTML = '<div class="event-log-empty" id="empty-state">' +
            '<div class="event-log-empty-icon">📭</div>' +
            '<div>No events captured yet</div>' +
            '<div style="font-size: 12px; margin-top: 5px;">Click a button to send an event</div>' +
            '</div>';
          updateEventCount();
        };

        window.toggleAutoScroll = function() {
          autoScroll = !autoScroll;
          const btn = document.getElementById('autoscroll-btn');
          btn.classList.toggle('active');
          btn.textContent = autoScroll ? '✓ Auto-scroll' : 'Auto-scroll';
        };

        // Expose functions globally for onclick handlers
        window.sendPageview = function() {
          posthog.capture('$pageview', {
            $current_url: window.location.href
          });
        };

        window.sendCustomEvent = function() {
          posthog.capture('custom_event', {
            test: 'data',
            timestamp: new Date().toISOString(),
            random: Math.random().toString(36).substring(7)
          });
        };

        window.onBotSelect = function(select) {
          const value = select.value;
          const selectedOption = select.options[select.selectedIndex];

          if (!value) {
            // Reset to real user agent
            userAgentOverride = null;
            selectedBotName = null;
            updateUserAgentDisplay();
            return;
          }

          if (value === 'custom') {
            const customUA = prompt('Enter custom User Agent:');
            if (customUA) {
              userAgentOverride = customUA;
              selectedBotName = 'Custom Bot';
              updateUserAgentDisplay();
            }
          } else {
            userAgentOverride = value;
            selectedBotName = selectedOption.text;
            updateUserAgentDisplay();
          }
        }

        function updateUserAgentDisplay() {
          const displayEl = document.getElementById('current-ua-display');
          const modeEl = document.getElementById('ua-mode');

          if (userAgentOverride) {
            displayEl.textContent = userAgentOverride;
            modeEl.innerHTML = '<span style="color: #f56565;">🤖 Testing as: ' + selectedBotName + '</span>';
            console.log('User Agent Override:', userAgentOverride);
          } else {
            displayEl.textContent = navigator.userAgent;
            modeEl.innerHTML = '<span style="color: #48bb78;">✅ Using Real Browser UA</span>';
            console.log('Using real user agent');
          }
        }

        // Initialize on load
        window.addEventListener('DOMContentLoaded', function() {
          console.log('Current User Agent:', navigator.userAgent);
          updateEventCount();
          updateUserAgentDisplay();
        });
      </script>
    </head>
    <body>
      <div class="header">
        <h1>🤖 Bot Detection & Pageview Collection Playground</h1>
        <p>Test PostHog's bot detection with real-time event monitoring</p>
      </div>

      <div class="container">
        <!-- Left Column: Controls -->
        <div class="left-column">
          <div class="card">
            <h2>Current User Agent</h2>
            <div id="ua-mode" style="font-weight: 600; margin-bottom: 10px; font-size: 14px;">
              <span style="color: #48bb78;">✅ Using Real Browser UA</span>
            </div>
            <div class="ua-display" id="current-ua-display">${userAgent}</div>
          </div>

          <div class="card">
            <h2>Bot Selector</h2>
            <select onchange="onBotSelect(this)">
              ${botOptionsHTML}
            </select>
            <div class="info-badge">
              💡 Select a bot to override the user agent for testing
            </div>
          </div>

          <div class="card">
            <h2>Test Actions</h2>
            <div class="button-group">
              <button class="btn-primary" onclick="sendPageview()">
                📄 Send $pageview Event
              </button>
              <button class="btn-success" onclick="sendCustomEvent()">
                ✨ Send Custom Event
              </button>
            </div>
          </div>

          <div class="card">
            <h3>How to Test</h3>
            <div class="instructions">
              <p style="margin-bottom: 10px;"><strong>Method 1: Bot Selector (Recommended)</strong></p>
              <ol style="margin-bottom: 15px;">
                <li>Select a bot from the dropdown above</li>
                <li>Click "Send $pageview Event"</li>
                <li>Watch it convert to $bot_pageview in the log →</li>
              </ol>

              <p style="margin-bottom: 10px;"><strong>Method 2: DevTools Override</strong></p>
              <ol>
                <li>Open DevTools (F12 or Cmd+Option+I)</li>
                <li>Open Network conditions (Cmd+Shift+P → "Show Network conditions")</li>
                <li>Uncheck "Use browser default"</li>
                <li>Select "Custom…" and paste a bot UA</li>
                <li>Refresh this page</li>
                <li>Click "Send $pageview Event"</li>
              </ol>
            </div>
          </div>
        </div>

        <!-- Right Column: Event Log -->
        <div class="right-column">
          <div class="event-log">
            <div class="event-log-header">
              <div class="event-log-title">
                Event Log
                <span class="event-count" id="event-count">0</span>
              </div>
              <div class="event-log-controls">
                <button class="btn-small active" id="autoscroll-btn" onclick="toggleAutoScroll()">✓ Auto-scroll</button>
                <button class="btn-small" onclick="clearEventLog()">🗑️ Clear</button>
              </div>
            </div>
            <div class="event-log-content" id="event-log-content">
              <div class="event-log-empty" id="empty-state">
                <div class="event-log-empty-icon">📭</div>
                <div>No events captured yet</div>
                <div style="font-size: 12px; margin-top: 5px;">Click a button to send an event</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `)
})

app.listen(PORT, () => {
    console.log(`🚀 Bot Detection Playground running at http://localhost:${PORT}`)
    console.log(`📊 PostHog: ${POSTHOG_API_HOST}`)
    console.log(`🔑 Token: ${POSTHOG_TOKEN}`)
})
