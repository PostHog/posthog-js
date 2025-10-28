import 'dotenv/config'
import express, { Request, Response } from 'express'
import path from 'path'

const app = express()
const PORT = 8080

const removeTrailingSlash = (str: string): string => str.replace(/\/$/, '')

// Environment variables (with fallbacks for local development)
const POSTHOG_TOKEN = process.env.POSTHOG_TOKEN || 'test-key'
const POSTHOG_API_HOST = removeTrailingSlash(process.env.POSTHOG_API_HOST || 'https://us.i.posthog.com')
const POSTHOG_UI_HOST = removeTrailingSlash(process.env.POSTHOG_UI_HOST || POSTHOG_API_HOST)

// Serve static assets
app.use('/static', express.static(path.join(__dirname, '../static')))

// Serve the built PostHog library from the parent directory
app.use('/posthog', express.static(path.join(__dirname, '../../../dist')))

// Helper function to generate bot selector options
function generateBotOptions(): string {
    return `
        <script src="/static/bot-data.js"></script>
        <script>
            function getBotOptionsHTML() {
                let html = '<option value="">-- Select a Bot --</option>';
                for (const [category, bots] of Object.entries(window.BOT_CATEGORIES)) {
                    html += \`<optgroup label="\${category}">\`;
                    bots.forEach((bot) => {
                        html += \`<option value="\${bot.example}" data-pattern="\${bot.pattern}">\${bot.name}</option>\`;
                    });
                    html += '</optgroup>';
                }
                html += '<option value="custom">✏️ Custom User Agent...</option>';
                return html;
            }

            window.addEventListener('DOMContentLoaded', function() {
                const botSelect = document.getElementById('bot-selector');
                if (botSelect) {
                    botSelect.innerHTML = getBotOptionsHTML();
                }
            });
        </script>
    `
}

// Home page with bot detection testing UI
app.get('/', (req: Request, res: Response) => {
    const userAgent = req.headers['user-agent'] || 'No User Agent'

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Bot Detection Playground</title>
      <link href="/static/styles.css" rel="stylesheet">
      <script src="/posthog/array.js"></script>
      ${generateBotOptions()}
      <script src="/static/main.js"></script>
      <script>
        // Initialize PostHog with config from server
        window.addEventListener('DOMContentLoaded', function() {
          window.initPostHog("${POSTHOG_TOKEN}", "${POSTHOG_API_HOST}", "${POSTHOG_UI_HOST}");
        });
      </script>
    </head>
    <body>
      <div class="container">
        <!-- Top Control Bar -->
        <div class="control-bar">
          <div class="card compact">
            <h2>Browser UA</h2>
            <div class="ua-display" style="font-size: 11px; padding: 8px;">${userAgent}</div>
          </div>

          <div class="card compact">
            <h2>Bot Selector</h2>
            <select id="bot-selector" onchange="onBotSelect(this)" style="font-size: 13px;">
              <option value="">Loading...</option>
            </select>
            <div style="font-size: 11px; color: #718096; margin-top: 6px;">
              💡 For reference only
            </div>
          </div>

          <div class="card compact" id="bot-ua-card" style="display: none;">
            <h2>Selected Bot UA</h2>
            <div class="ua-display" id="bot-ua-display" style="font-size: 11px; padding: 8px; border-left-color: #f56565;"></div>
            <div style="font-size: 11px; color: #718096; margin-top: 6px;">
              📋 Copy to use in DevTools
            </div>
          </div>

          <div class="card compact">
            <h2>Actions</h2>
            <div class="button-group" style="gap: 8px;">
              <button class="btn-primary" onclick="sendPageview()" style="padding: 8px 12px; font-size: 13px;">
                📄 $pageview
              </button>
              <button class="btn-success" onclick="sendCustomEvent()" style="padding: 8px 12px; font-size: 13px;">
                ✨ Custom
              </button>
            </div>
          </div>

          <div class="card wide">
            <h2>How to Test</h2>
            <div style="font-size: 12px;">
              <strong>1.</strong> Select bot → <strong>2.</strong> Open DevTools (F12) → <strong>3.</strong> Network conditions (Cmd+Shift+P) → <strong>4.</strong> Set Custom UA → <strong>5.</strong> Refresh → <strong>6.</strong> Send event
            </div>
          </div>
        </div>

        <!-- Event Log -->
        <div class="event-log-container">
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
