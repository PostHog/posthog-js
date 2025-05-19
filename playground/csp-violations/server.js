require('dotenv').config()
const express = require('express')
const path = require('path')
const app = express()
const PORT = 8080

const removeTrailingSlash = (str) => str.replace(/\/$/, '')

if (!process.env.POSTHOG_TOKEN || !process.env.POSTHOG_API_HOST) {
    throw new Error('POSTHOG_TOKEN and POSTHOG_API_HOST must be set')
}

// UPDATE YOUR TOKEN!!!
const POSTHOG_TOKEN = process.env.POSTHOG_TOKEN
const POSTHOG_API_HOST = removeTrailingSlash(process.env.POSTHOG_API_HOST)
const POSTHOG_UI_HOST = removeTrailingSlash(process.env.POSTHOG_UI_HOST || POSTHOG_API_HOST)
const POSTHOG_USE_SNIPPET = process.env.POSTHOG_USE_SNIPPET === 'true' || process.env.POSTHOG_USE_SNIPPET === '1'

const POSTHOG_SCRIPT = POSTHOG_USE_SNIPPET
    ? `<script>
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init bs ws ge fs capture De calculateEventProperties $s register register_once register_for_session unregister unregister_for_session Is getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey canRenderSurveyAsync identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty xs Ss createPersonProfile Es gs opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing ys debug ks getPageViewId captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    posthog.init("${POSTHOG_TOKEN}", {
        api_host: "${POSTHOG_API_HOST}",
        ui_host: "${POSTHOG_UI_HOST}",
    })
</script>`
    : `<script src="/dist/posthog.js"></script>`

const CSP_REPORT_URI = `${POSTHOG_API_HOST}/report?token=${POSTHOG_TOKEN}`
const USE_REPORT_TO = POSTHOG_API_HOST.startsWith('https://')

const CSP_RULES = {
    'default-src': "'self'",
    'script-src': `'self' ${POSTHOG_API_HOST} ${POSTHOG_USE_SNIPPET ? "'unsafe-inline'" : "'nonce-123'"}`,
    'connect-src': `'self' ${POSTHOG_API_HOST} ${POSTHOG_UI_HOST} https://*.posthog.com`,
    'img-src': "'self' data:",
    'style-src': `'self' ${POSTHOG_UI_HOST}`,
    'report-uri': CSP_REPORT_URI + '&type=report-uri',
    ...(USE_REPORT_TO
        ? {
              'report-to': 'posthog', // easier to debug with report-uri
          }
        : {}),
}

const CSP_HEADER = Object.entries(CSP_RULES)
    .map(([key, value]) => `${key} ${value}`)
    .join('; ')
const REPORTING_HEADER = `posthog="${CSP_REPORT_URI}&type=report-to"`

app.use('/dist', express.static(path.join(__dirname, 'dist')))
app.use('/static', express.static(path.join(__dirname, 'static')))

app.use((req, res, next) => {
    // Set CSP as headers, we can probably make this a bit more configurable for the playground
    res.setHeader('Content-Security-Policy-Report-Only', CSP_HEADER)
    if (USE_REPORT_TO) {
        res.setHeader('Reporting-Endpoints', REPORTING_HEADER)
    }
    next()
})

// Home page - displays links to violation examples
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>CSP Violation Playground</title>
      <link href="/static/styles.css" rel="stylesheet">
      <script src="/dist/main.js"></script>
      ${POSTHOG_SCRIPT}
    </head>
    <body>
      <h1>CSP Violation Playground</h1>
      
      <div class="card">
        <h2>CSP Violation Examples</h2>
        <p>Click the links below to see pages that trigger different types of CSP violations:</p>
        
        <a href="/inline-script" class="button">Inline Script Violation</a>
        <a href="/external-script" class="button">External Script Violation</a>
        <a href="/external-img" class="button">External Image Violation</a>
        <a href="/external-style" class="button">External Style Violation</a>
        <a href="/xhr-violation" class="button">XHR Violation</a>
        <a href="/eval" class="button">Eval</a>
      </div>
      
      <div class="card">
        <h2>CSP Report Endpoint</h2>
        <p>This playground is configured to send CSP violation reports to:</p>
        <pre>${CSP_REPORT_URI}</pre>
        <p>Current CSP policy:</p>
        <pre>${JSON.stringify(CSP_RULES, null, 2)}</pre>
      </div>
    </body>
    </html>
  `)
})

// Inline script violation
app.get('/inline-script', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Inline Script Violation</title>
      <link href="/static/styles.css" rel="stylesheet">
      <script src="/dist/main.js"></script>
      ${POSTHOG_SCRIPT}
    </head>
    <body>
      <h1>Inline Script Violation</h1>
      <div class="card">
        <p>This page contains an inline script that violates CSP.</p>
        <p><a href="/">Back to Home</a></p>
      </div>
      <!-- This inline script violates CSP -->
      <script>
        console.log("This inline script violates CSP");
        document.body.style.backgroundColor = "#f8fafc";
      </script>
    </body>
    </html>
  `)
})

// External script violation
app.get('/external-script', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>External Script Violation</title>
      <link href="/static/styles.css" rel="stylesheet">
      <script src="/dist/main.js"></script>
      ${POSTHOG_SCRIPT}
      <!-- This external script violates CSP -->
      <script src="https://example.com/script.js"></script>
    </head>
    <body>
      <h1>External Script Violation</h1>
      <div class="card">
        <p>This page loads a script from example.com which violates CSP.</p>
        <p><a href="/">Back to Home</a></p>
      </div>
    </body>
    </html>
  `)
})

// External image violation
app.get('/external-img', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>External Image Violation</title>
      <link href="/static/styles.css" rel="stylesheet">
      <script src="/dist/main.js"></script>
      ${POSTHOG_SCRIPT}
    </head>
    <body>
      <h1>External Image Violation</h1>
      <div class="card">
        <p>This page loads an image from example.com which violates CSP.</p>
        <!-- This image violates CSP -->
        <img src="https://example.com/image.jpg" alt="CSP Violation Image" width="300">
        <p><a href="/">Back to Home</a></p>
      </div>
    </body>
    </html>
  `)
})

// External style violation
app.get('/external-style', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>External Style Violation</title>
      <link href="/static/styles.css" rel="stylesheet">
      <script src="/dist/main.js"></script>
      ${POSTHOG_SCRIPT}
      <!-- This external stylesheet violates CSP -->
      <link rel="stylesheet" href="https://example.com/styles.css">
    </head>
    <body>
      <h1>External Style Violation</h1>
      <div class="card">
        <p>This page loads a stylesheet from example.com which violates CSP.</p>
        <p><a href="/">Back to Home</a></p>
      </div>
    </body>
    </html>
  `)
})

// XHR violation with auto-executing JS
app.get('/xhr-violation', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>XHR Violation</title>
      <link href="/static/styles.css" rel="stylesheet">
      <script src="/dist/main.js"></script>
      ${POSTHOG_SCRIPT}
    </head>
    <body>
      <h1>XHR Violation</h1>
      <div class="card">
        <p>This page attempts to make an XHR request to example.com which violates CSP.</p>
        <p><a href="/">Back to Home</a></p>
        <div id="result"></div>
      </div>
      <!-- We use nonce so that this script is allowed to run despite being inline-->
      <script nonce="123">
        // The XHR request will violate CSP
        setTimeout(() => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', 'https://example.com/api');
          xhr.send();
          
          document.getElementById('result').innerHTML = 
            'XHR request sent to example.com. Check browser console for CSP violation.';
        }, 1000);
      </script>
    </body>
    </html>
  `)
})

app.get('/eval', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Eval Violation</title>
      <link href="/static/styles.css" rel="stylesheet">
      <script src="/dist/main.js"></script>
      ${POSTHOG_SCRIPT}
    </head>
    <body>
      <h1>XHR Violation</h1>
      <div class="card">
        <p>This page attempts to execute code using eval() which violates CSP.</p>
        <p><a href="/">Back to Home</a></p>
        <div id="result"></div>
      </div>
            <!-- We use nonce so that this script is allowed to run despite being inline-->

      <script nonce="123">
        // The eval will violate CSP
        setTimeout(() => {
          eval('console.log("Hello, world! - sent from my eval")');
        }, 1000);
      </script>
    </body>
    </html>
  `)
})

// Start the server
app.listen(PORT, () => {
    console.log(`CSP Violation Playground running at http://localhost:${PORT}`)
})
