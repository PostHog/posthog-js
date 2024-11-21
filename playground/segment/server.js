// eslint-disable-next-line @typescript-eslint/no-require-imports,no-undef
const path = require('path')
// eslint-disable-next-line @typescript-eslint/no-require-imports,no-undef
const express = require('express')
const app = express()
const port = 3001

// eslint-disable-next-line no-undef
app.use('/static', express.static(__dirname + '/../../dist'))

app.get('/segment.html', function (req, res) {
    // eslint-disable-next-line no-undef
    res.sendFile(__dirname + '/segment.html')
})

app.get('/static/recorder.js', function (req, res) {
    // eslint-disable-next-line no-undef
    let filePath = path.join(__dirname, '/../../node_modules/rrweb/dist/rrweb.js')
    res.sendFile(filePath)
})

app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Example Segment app listening on port ${port}`)
})
