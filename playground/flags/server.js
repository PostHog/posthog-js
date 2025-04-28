const express = require('express')
const path = require('path')
const app = express()
const port = 3000

// Serve static files from the dist directory
app.use('/dist', express.static(path.join(__dirname, '../../dist')))

// Serve the demo.html file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'demo.html'))
})

app.listen(port, () => {
    console.log(`Demo server running at http://localhost:${port}`)
})
