const path = require('path')
const express = require('express')
const app = express()
const port = 3001

app.use('/static', express.static(__dirname + '/../../dist'))

app.get('/', function (req, res) {
    res.sendFile(__dirname + '/index.html')
})

app.get('/static/recorder.js', function (req, res) {
    let filePath = path.join(__dirname, '/../../node_modules/rrweb/dist/rrweb.min.js')
    res.sendFile(filePath)
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})

app.post('/decide', function (req, res) {
    res.json({
        config: { enable_collect_everything: false },
        editorParams: {},
        featureFlags: ['session-recording-player'],
        isAuthenticated: false,
        sessionRecording: {
            endpoint: '/ses/',
        },
        supportedCompression: ['gzip', 'lz64'],
    })
})
