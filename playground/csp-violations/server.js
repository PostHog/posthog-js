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

const CSP_REPORT_URI = `${POSTHOG_API_HOST}/report/?token=${POSTHOG_TOKEN}`
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
        <h2>Report-To Debug Cases</h2>
        <p>Test cases for debugging report-to directive issues:</p>
        
        <a href="/debug-enabled" class="button">Debug Enabled (with ?debug=true)</a>
        <a href="/invalid-content-type" class="button">Invalid Content Type</a>
        <a href="/report-uri-only" class="button">Report-URI Only</a>
        <a href="/report-to-only" class="button">Report-To Only</a>
        <a href="/both-report-directives" class="button">Both Report Directives</a>
        <a href="/malformed-reporting-endpoints" class="button">Malformed Reporting Endpoints</a>
        <a href="/sampling-test/default" class="button">Sampling Test (Multiple Violations)</a>
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

// Debug enabled test - adds debug=true parameter to CSP report endpoint
app.get('/debug-enabled', (req, res) => {
    const debugCSPRules = {
        ...CSP_RULES,
        'report-uri': CSP_REPORT_URI + '&type=report-uri&debug=true',
    }
    const debugCSPHeader = Object.entries(debugCSPRules)
        .map(([key, value]) => `${key} ${value}`)
        .join('; ')

    res.setHeader('Content-Security-Policy-Report-Only', debugCSPHeader)
    if (USE_REPORT_TO) {
        res.setHeader('Reporting-Endpoints', `posthog="${CSP_REPORT_URI}&type=report-to&debug=true"`)
    }

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Debug Enabled Test</title>
      <link href="/static/styles.css" rel="stylesheet">
      <script src="/dist/main.js"></script>
      ${POSTHOG_SCRIPT}
    </head>
    <body>
      <h1>Debug Enabled Test</h1>
      <div class="card">
        <p>This page has debug=true parameter enabled in CSP report endpoints.</p>
        <p>CSP reports will include verbose debug logging.</p>
        <p><a href="/">Back to Home</a></p>
      </div>
      <!-- This inline script violates CSP and should trigger debug logs -->
      <script>
        console.log("Debug enabled violation - this should generate detailed logs");
      </script>
    </body>
    </html>
  `)
})

app.get('/debug-case-insensitive', (req, res) => {
    const debugCSPRules = {
        ...CSP_RULES,
        'report-uri': CSP_REPORT_URI + '&type=report-uri&DEBUG=true',
    }
    const debugCSPHeader = Object.entries(debugCSPRules)
        .map(([key, value]) => `${key} ${value}`)
        .join('; ')

    res.setHeader('Content-Security-Policy-Report-Only', debugCSPHeader)
    if (USE_REPORT_TO) {
        res.setHeader('Reporting-Endpoints', `posthog="${CSP_REPORT_URI}&type=report-to&DEBUG=true"`)
    }

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Debug Case Insensitive Test</title>
      <link href="/static/styles.css" rel="stylesheet">
      <script src="/dist/main.js"></script>
      ${POSTHOG_SCRIPT}
    </head>
    <body>
      <h1>Debug Case Insensitive Test</h1>
      <div class="card">
        <p>This page has DEBUG=true parameter (uppercase) to test case insensitive handling.</p>
        <p><a href="/">Back to Home</a></p>
      </div>
      <!-- This inline script violates CSP -->
      <script>
        console.log("Case insensitive debug test violation");
      </script>
    </body>
    </html>
  `)
})

app.get('/invalid-content-type', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Invalid Content Type Test</title>
      <link href="/static/styles.css" rel="stylesheet">
      <script src="/dist/main.js"></script>
      ${POSTHOG_SCRIPT}
    </head>
    <body>
      <h1>Invalid Content Type Test</h1>
      <div class="card">
        <p>This page will attempt to send CSP reports with invalid content type.</p>
        <p>This should trigger error logging for invalid content type.</p>
        <p><a href="/">Back to Home</a></p>
      </div>
      <!-- This inline script violates CSP -->
      <script>
        console.log("Invalid content type test violation");
        
        // Manually send a CSP report with wrong content type
        setTimeout(() => {
          fetch('${CSP_REPORT_URI}&type=manual&debug=true', {
            method: 'POST',
            headers: {
              'Content-Type': 'text/plain', // Wrong content type
            },
            body: JSON.stringify({
              'csp-report': {
                'document-uri': window.location.href,
                'violated-directive': 'script-src',
                'blocked-uri': 'inline',
                'source-file': window.location.href,
                'line-number': 1,
                'column-number': 1
              }
            })
          }).catch(console.error);
        }, 1000);
      </script>
    </body>
    </html>
  `)
})

app.get('/report-uri-only', (req, res) => {
    const reportUriOnlyRules = {
        'default-src': "'self'",
        'script-src': `'self' ${POSTHOG_API_HOST} 'nonce-123'`,
        'connect-src': `'self' ${POSTHOG_API_HOST} ${POSTHOG_UI_HOST} https://*.posthog.com`,
        'img-src': "'self' data:",
        'style-src': `'self' ${POSTHOG_UI_HOST}`,
        'report-uri': CSP_REPORT_URI + '&type=report-uri-only&debug=true',
    }
    const reportUriHeader = Object.entries(reportUriOnlyRules)
        .map(([key, value]) => `${key} ${value}`)
        .join('; ')

    res.setHeader('Content-Security-Policy-Report-Only', reportUriHeader)
    // Explicitly NOT setting Reporting-Endpoints header

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Report-URI Only Test</title>
      <link href="/static/styles.css" rel="stylesheet">
      <script src="/dist/main.js"></script>
      ${POSTHOG_SCRIPT}
    </head>
    <body>
      <h1>Report-URI Only Test</h1>
      <div class="card">
        <p>This page uses only report-uri directive (no report-to).</p>
        <p>CSP Policy: <code>${reportUriHeader}</code></p>
        <p><a href="/">Back to Home</a></p>
      </div>
      <!-- This inline script violates CSP -->
      <script>
        console.log("Report-URI only violation");
      </script>
    </body>
    </html>
  `)
})

app.get('/report-to-only', (req, res) => {
    const reportToOnlyRules = {
        'default-src': "'self'",
        'script-src': `'self' ${POSTHOG_API_HOST} 'nonce-123'`,
        'connect-src': `'self' ${POSTHOG_API_HOST} ${POSTHOG_UI_HOST} https://*.posthog.com`,
        'img-src': "'self' data:",
        'style-src': `'self' ${POSTHOG_UI_HOST}`,
        'report-to': 'posthog-debug',
    }
    const reportToHeader = Object.entries(reportToOnlyRules)
        .map(([key, value]) => `${key} ${value}`)
        .join('; ')

    res.setHeader('Content-Security-Policy-Report-Only', reportToHeader)
    res.setHeader('Reporting-Endpoints', `posthog-debug="${CSP_REPORT_URI}&type=report-to-only&debug=true"`)

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Report-To Only Test</title>
      <link href="/static/styles.css" rel="stylesheet">
      <script src="/dist/main.js"></script>
      ${POSTHOG_SCRIPT}
    </head>
    <body>
      <h1>Report-To Only Test</h1>
      <div class="card">
        <p>This page uses only report-to directive (no report-uri).</p>
        <p>CSP Policy: <code>${reportToHeader}</code></p>
        <p>Reporting Endpoints: <code>posthog-debug="${CSP_REPORT_URI}&type=report-to-only&debug=true"</code></p>
        <p><a href="/">Back to Home</a></p>
      </div>
      <!-- This inline script violates CSP -->
      <script>
        console.log("Report-To only violation");
      </script>
    </body>
    </html>
  `)
})

app.get('/both-report-directives', (req, res) => {
    const bothReportRules = {
        'default-src': "'self'",
        'script-src': `'self' ${POSTHOG_API_HOST} 'nonce-123'`,
        'connect-src': `'self' ${POSTHOG_API_HOST} ${POSTHOG_UI_HOST} https://*.posthog.com`,
        'img-src': "'self' data:",
        'style-src': `'self' ${POSTHOG_UI_HOST}`,
        'report-uri': CSP_REPORT_URI + '&type=both-report-uri&debug=true',
        'report-to': 'posthog-both',
    }
    const bothReportHeader = Object.entries(bothReportRules)
        .map(([key, value]) => `${key} ${value}`)
        .join('; ')

    res.setHeader('Content-Security-Policy-Report-Only', bothReportHeader)
    res.setHeader('Reporting-Endpoints', `posthog-both="${CSP_REPORT_URI}&type=both-report-to&debug=true"`)

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Both Report Directives Test</title>
      <link href="/static/styles.css" rel="stylesheet">
      <script src="/dist/main.js"></script>
      ${POSTHOG_SCRIPT}
    </head>
    <body>
      <h1>Both Report Directives Test</h1>
      <div class="card">
        <p>This page uses both report-uri and report-to directives.</p>
        <p>CSP Policy: <code>${bothReportHeader}</code></p>
        <p>Reporting Endpoints: <code>posthog-both="${CSP_REPORT_URI}&type=both-report-to&debug=true"</code></p>
        <p><a href="/">Back to Home</a></p>
      </div>
      <!-- This inline script violates CSP -->
      <script>
        console.log("Both report directives violation");
      </script>
    </body>
    </html>
  `)
})

app.get('/malformed-reporting-endpoints', (req, res) => {
    const malformedRules = {
        'default-src': "'self'",
        'script-src': `'self' ${POSTHOG_API_HOST} 'nonce-123'`,
        'connect-src': `'self' ${POSTHOG_API_HOST} ${POSTHOG_UI_HOST} https://*.posthog.com`,
        'img-src': "'self' data:",
        'style-src': `'self' ${POSTHOG_UI_HOST}`,
        'report-to': 'malformed-endpoint',
    }
    const malformedHeader = Object.entries(malformedRules)
        .map(([key, value]) => `${key} ${value}`)
        .join('; ')

    res.setHeader('Content-Security-Policy-Report-Only', malformedHeader)
    // Malformed Reporting-Endpoints header (missing quotes, invalid format)
    res.setHeader(
        'Reporting-Endpoints',
        `malformed-endpoint=${CSP_REPORT_URI}&type=malformed&debug=true, invalid=syntax`
    )

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Malformed Reporting Endpoints Test</title>
      <link href="/static/styles.css" rel="stylesheet">
      <script src="/dist/main.js"></script>
      ${POSTHOG_SCRIPT}
    </head>
    <body>
      <h1>Malformed Reporting Endpoints Test</h1>
      <div class="card">
        <p>This page has malformed Reporting-Endpoints header.</p>
        <p>CSP Policy: <code>${malformedHeader}</code></p>
        <p>Malformed Reporting Endpoints: <code>malformed-endpoint=${CSP_REPORT_URI}&type=malformed&debug=true, invalid=syntax</code></p>
        <p>This should trigger error logging for malformed headers.</p>
        <p><a href="/">Back to Home</a></p>
      </div>
      <!-- This inline script violates CSP -->
      <script>
        console.log("Malformed reporting endpoints violation");
      </script>
    </body>
    </html>
  `)
})

app.get('/sampling-test/:path?', (req, res) => {
    // Get the number of different URLs from query parameter, default to 20
    const numUrls = parseInt(req.query.urls) || 20
    const useRandomDomains = req.query.random === 'true'
    const testPath = req.params.path || 'default'

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Sampling Test - ${testPath}</title>
      <link href="/static/styles.css" rel="stylesheet">
      <script src="/dist/main.js"></script>
      ${POSTHOG_SCRIPT}
    </head>
    <body>
      <h1>Sampling Test - ${testPath}</h1>
      <div class="card">
        <p>This page generates multiple CSP violations to test sampling behavior.</p>
        <p>Test path: <strong>${testPath}</strong></p>
        <p>Generating <strong>${numUrls}</strong> violations with ${useRandomDomains ? 'random domains' : 'sequential URLs'}.</p>
        <p>Each URL includes random query parameters and hashes to bypass URL-based sampling.</p>
        <p>Some reports may be sampled out and should trigger sampling logs.</p>
        <p><a href="/">Back to Home</a></p>
        <div id="violation-count">Violations generated: 0</div>
        <div id="config">
          <p>Configuration options:</p>
          <a href="/sampling-test/test1?urls=10" class="button">Test1 - 10 URLs</a>
          <a href="/sampling-test/test2?urls=50" class="button">Test2 - 50 URLs</a>
          <a href="/sampling-test/test3?urls=100" class="button">Test3 - 100 URLs</a>
          <a href="/sampling-test/random?urls=20&random=true" class="button">Random - 20 Domains</a>
          <a href="/sampling-test/stress?urls=200&random=true" class="button">Stress - 200 Random</a>
        </div>
      </div>

      <!-- Multiple inline scripts to generate many violations -->
      <script nonce="123">
        let violationCount = 0;
        const countElement = document.getElementById('violation-count');
        const numUrls = ${numUrls};
        const useRandomDomains = ${useRandomDomains};
        const testPath = '${testPath}';

        const randomDomains = [
          'example.com',
          'test-domain.org',
          'random-site.net',
          'fake-cdn.io',
          'malicious-site.co',
          'untrusted-source.dev',
          'external-resource.app',
          'third-party.xyz',
        ];

        const getRandomDomain = () => {
          return randomDomains[Math.floor(Math.random() * randomDomains.length)];
        };

        const getDomain = (index) => {
          return useRandomDomains ? getRandomDomain() : 'example.com';
        };

        const getPath = (index) => {
          if (useRandomDomains) {
            const paths = ['script', 'resource', 'asset', 'file', 'content'];
            const path = paths[Math.floor(Math.random() * paths.length)];
            const id = Math.floor(Math.random() * 1000);
            const hash = Math.random().toString(36).substring(2, 15);
            const queryParams = [
              \`v=\${Math.floor(Math.random() * 100)}\`,
              \`t=\${Date.now()}\`,
              \`r=\${Math.random().toString(36).substring(2, 8)}\`,
              \`path=\${testPath}\`
            ].join('&');
            return \`/\${path}\${id}?\${queryParams}#\${hash}\`;
          }
          const hash = Math.random().toString(36).substring(2, 15);
          const queryParams = [
            \`v=\${Math.floor(Math.random() * 100)}\`,
            \`t=\${Date.now() + index}\`,
            \`r=\${Math.random().toString(36).substring(2, 8)}\`,
            \`path=\${testPath}\`
          ].join('&');
          return \`/script\${index}?\${queryParams}#\${hash}\`;
        };

        // Generate multiple violations rapidly
        for (let i = 0; i < numUrls; i++) {
          setTimeout(() => {
            const domain = getDomain(i);
            const scriptPath = getPath(i);
            const imagePath = getPath(i + 1000);

            try {
              // This will violate CSP
              eval(\`console.log("Sampling test violation #\${i + 1} from \${domain} (path: \${testPath})");\`);
              violationCount++;
              countElement.textContent = \`Violations generated: \${violationCount}\`;
            } catch (e) {
              // Expected to fail due to CSP
            }

            // Try to load external scripts from different domains/paths
            const script = document.createElement('script');
            script.src = \`https://\${domain}\${scriptPath}.js\`;
            document.head.appendChild(script);

            // And external images from different domains/paths
            const img = document.createElement('img');
            img.src = \`https://\${domain}\${imagePath}.jpg\`;
            img.style.display = 'none';
            document.body.appendChild(img);

            // Also try some CSS violations
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = \`https://\${domain}\${getPath(i + 2000)}.css\`;
            document.head.appendChild(link);
          }, i * 50); // Faster generation for more realistic sampling test
        }
      </script>
    </body>
    </html>
  `)
})

// Start the server
app.listen(PORT, () => {
    console.log(`CSP Violation Playground running at http://localhost:${PORT}`)
})
