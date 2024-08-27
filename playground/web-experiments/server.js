const path = require('path')
const express = require('express')
const app = express()
const port = 3001

app.use('/static', express.static(__dirname + '/../../dist'))
app.use(express.static('public'))

app.get('/index.html', function (req, res) {
    res.sendFile(__dirname + '/index.html')
})

app.get('/blog.html', function (req, res) {
    res.sendFile(__dirname + '/blog.html')
})



app.get('/css/style.css', function (req, res) {
    res.sendFile(__dirname + '/css/style.css')
})

app.get('/css/mobile.css', function (req, res) {
    res.sendFile(__dirname + '/css/mobile.css')
})


app.get('/static/recorder.js', function (req, res) {
    let filePath = path.join(__dirname, '/../../node_modules/rrweb/dist/rrweb.min.js')
    res.sendFile(filePath)
})

app.listen(port, () => {
    console.log(`Example web experiments app listening on port ${port}`)
})
