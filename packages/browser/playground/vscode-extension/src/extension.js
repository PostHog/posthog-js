const vscode = require('vscode');

function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('posthog.start', () => {
            const panel = vscode.window.createWebviewPanel(
                'posthogPlayground',
                'PostHog Playground',
                vscode.ViewColumn.One,
                {
                    enableScripts: true
                }
            );

            panel.webview.html = getWebviewContent();

            panel.webview.onDidReceiveMessage(
                message => {
                    switch (message.command) {
                        case 'alert':
                            vscode.window.showInformationMessage(message.text);
                            return;
                    }
                },
                undefined,
                context.subscriptions
            );
        })
    );
}

function getWebviewContent() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PostHog Playground</title>
    <script>
        !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host+"/static/array.full.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
        posthog.init(
       'YOUR_PROJECT_KEY_HERE', 
        {
        api_host: 'http://localhost:8010', 
        defaults: '2025-05-24',
        enable_recording_console_log: true,
        disable_session_recording: false,
        persistence: 'localStorage+cookie',
        person_profiles: 'always', // or 'always' to create profiles for anonymous users as well
        })
    </script>
</head>
<body>
    <h1>PostHog VS Code Extension Playground</h1>
    <input type="text" id="text-input" placeholder="Enter some text" />
    <button id="test-button">test</button>

    <script>
        const vscode = acquireVsCodeApi();
        document.getElementById('test-button').addEventListener('click', () => {
            const text = document.getElementById('text-input').value;
            posthog.capture('test-button-clicked', { text_input: text });
            vscode.postMessage({
                command: 'alert',
                text: 'PostHog event captured!'
            });
        });
    </script>
</body>
</html>`;
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
} 