const express = require('express')
const path = require('path')
const { v7: uuidv7 } = require('uuid')
const app = express()
const PORT = 8080

// UPDATE YOUR TOKEN!!!
const POSTHOG_TOKEN = 'phc_tQttuNsuNT6bHLQTFvvxIHjXXcOKWIk7NySsAjw42EF'
const POSTHOG_SNIPPET = `<script>
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init bs ws ge fs capture De calculateEventProperties $s register register_once register_for_session unregister unregister_for_session Is getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey canRenderSurveyAsync identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty xs Ss createPersonProfile Es gs opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing ys debug ks getPageViewId captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    posthog.init("${POSTHOG_TOKEN}", {
        api_host: 'http://localhost:8010',
        person_profiles: 'identified_only',
    })
</script>`

const CSP_REPORT_URI = `http://localhost:8010/csp?token=${POSTHOG_TOKEN}&pid=${uuidv7()}`
const USE_REPORT_TO = CSP_REPORT_URI.startsWith('https://')

const CSP_RULES = {
    'default-src': "'self'",
    'script-src': "'self' https://*.posthog.com http://localhost:8010 'unsafe-inline'",
    'connect-src': "'self' https://*.posthog.com http://localhost:8010",
    'img-src': "'self' data:",
    'style-src': "'self'",
    'report-uri': CSP_REPORT_URI,
    ...(USE_REPORT_TO
        ? {
              'report-to': 'csp-endpoint', // easier to debug with report-uri
          }
        : {}),
}

const CSP_HEADER = Object.entries(CSP_RULES)
    .map(([key, value]) => `${key} ${value}`)
    .join('; ')
const REPORTING_HEADER = `csp-endpoint="${CSP_REPORT_URI}"`

app.use(express.static(path.join(__dirname, 'public')))

app.use((req, res, next) => {
    // Set CSP as headers, we can probably make this a bit more configurable for the playground
    res.setHeader('Content-Security-Policy', CSP_HEADER)
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
      <style>
        body {
          font-family: system-ui, -apple-system, sans-serif;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
          line-height: 1.6;
        }
        h1 {
          margin-bottom: 30px;
          color: #4338ca;
        }
        .card {
          border: 1px solid #ddd;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 20px;
          background-color: #f9fafb;
        }
        a.button {
          display: inline-block;
          background-color: #4f46e5;
          color: white;
          text-decoration: none;
          padding: 10px 15px;
          border-radius: 4px;
          margin-right: 10px;
          margin-bottom: 10px;
        }
        a.button:hover {
          background-color: #4338ca;
        }
        pre {
          background-color: #1e293b;
          color: #e2e8f0;
          padding: 15px;
          border-radius: 4px;
          overflow-x: auto;
        }
      </style>
      ${POSTHOG_SNIPPET}
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
      <style>
        body { font-family: system-ui; max-width: 800px; margin: 20px auto; }
        h1 { color: #4338ca; }
        .card { border: 1px solid #ddd; padding: 20px; border-radius: 8px; }
        a { color: #4f46e5; }
      </style>
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
      <style>
        body { font-family: system-ui; max-width: 800px; margin: 20px auto; }
        h1 { color: #4338ca; }
        .card { border: 1px solid #ddd; padding: 20px; border-radius: 8px; }
        a { color: #4f46e5; }
      </style>
      <!-- This external script violates CSP -->
      <script src="https://example.com/script.js"></script>
      ${POSTHOG_SNIPPET}
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
      <style>
        body { font-family: system-ui; max-width: 800px; margin: 20px auto; }
        h1 { color: #4338ca; }
        .card { border: 1px solid #ddd; padding: 20px; border-radius: 8px; }
        a { color: #4f46e5; }
      </style>
      ${POSTHOG_SNIPPET}
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
      <!-- This external stylesheet violates CSP -->
      <link rel="stylesheet" href="https://example.com/styles.css">
      <style>
        body { font-family: system-ui; max-width: 800px; margin: 20px auto; }
        h1 { color: #4338ca; }
        .card { border: 1px solid #ddd; padding: 20px; border-radius: 8px; }
        a { color: #4f46e5; }
      </style>
      ${POSTHOG_SNIPPET}
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
      <style>
        body { font-family: system-ui; max-width: 800px; margin: 20px auto; }
        h1 { color: #4338ca; }
        .card { border: 1px solid #ddd; padding: 20px; border-radius: 8px; }
        a { color: #4f46e5; }
      </style>
      ${POSTHOG_SNIPPET}
    </head>
    <body>
      <h1>XHR Violation</h1>
      <div class="card">
        <p>This page attempts to make an XHR request to example.com which violates CSP.</p>
        <p><a href="/">Back to Home</a></p>
        <div id="result"></div>
      </div>
      <!-- We need to use a script from a permitted domain to execute the XHR violation -->
      <script>
        // This part is allowed by CSP because it's inline in the page
        // But the XHR request will violate CSP
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

// Start the server
app.listen(PORT, () => {
    console.log(`CSP Violation Playground running at http://localhost:${PORT}`)
})
