const path = require('path')
const express = require('express')
const app = express()
const port = 3001

app.use('/static', express.static(__dirname + '/../../dist'))

app.get('/segment.html', function (req, res) {
    res.sendFile(__dirname + '/segment.html')
})

app.get('/static/recorder.js', function (req, res) {
    let filePath = path.join(__dirname, '/../../node_modules/rrweb/dist/rrweb.umd.min.cjs')
    res.sendFile(filePath)
})

app.listen(port, () => {
    console.log(`Example Segment app listening on port ${port}`)
})
