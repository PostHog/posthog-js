const proxy = require('express-http-proxy')
const app = require('express')()
const express = require('express')
const path = require('path')
const fs = require('fs')

const POSTGOG_API_URL = process.env.POSTGOG_API_URL || 'http://0.0.0.0:8000'
const PORT = process.env.PORT || 3001

app.use('/ingest/static', express.static(__dirname + '/../../dist'))
app.use('/ingest', proxy(POSTGOG_API_URL))

const pages = fs.readdirSync(path.join(__dirname, '/pages'))

pages.forEach((file) => {
    app.get('/' + file, function (req, res) {
        res.sendFile(path.join(__dirname, '/pages/' + file))
    })
})

app.get('/', function (req, res) {
    res.json({ pages: pages.map((page) => `http://localhost:${PORT}/${page}`) })
})

app.listen(PORT, () => {
    console.log(`Playground running at http://localhost:${PORT}. Proxying to ${POSTGOG_API_URL}`)
})
