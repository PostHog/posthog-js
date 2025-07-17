/* eslint-env node */
import express from 'express'
import path from 'path'
import { createGunzip } from 'zlib'
import { pipeline } from 'stream'

const app = express()
const port = process.argv.includes('--port') ? parseInt(process.argv[process.argv.indexOf('--port') + 1]) : 2345
const eventStore = []

app.use('/static', express.static(path.resolve(process.cwd(), 'dist')))
app.use('/playground', express.static(path.resolve(process.cwd(), 'playground')))

app.get('/api/projects/1/events', (req, res) => {
    const properties = req.query.properties
    let matchingEvents = eventStore
    if (properties) {
        try {
            const parsedProperties = JSON.parse(properties)
            const testSessionId = parsedProperties.find((prop) => prop.key === 'testSessionId')
            if (testSessionId) {
                matchingEvents = eventStore.filter((event) => event.properties.testSessionId === testSessionId.value[0])
            }
        } catch (error) {
            console.error('Error parsing properties:', error)
        }
    }

    res.set({
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': 'true',
    }).json({ results: matchingEvents })
})

// Middleware to decompress gzip-encoded request bodies
app.use((req, res, next) => {
    if (req.query.compression === 'gzip-js') {
        const gunzip = createGunzip()
        let body = Buffer.concat([])

        pipeline(req, gunzip, (err) => {
            if (err) {
                console.error('Error decompressing gzip body:', err)
                return next(err)
            }
        })

        gunzip.on('data', (chunk) => {
            body = Buffer.concat([body, chunk])
        })

        gunzip.on('end', () => {
            try {
                req.body = JSON.parse(body.toString())
                next()
            } catch (parseError) {
                console.error('Error parsing decompressed body:', parseError)
                next(parseError)
            }
        })
    } else {
        next()
    }
})
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use(/^\/e/, (req, res) => {
    if (req.body) {
        let events
        if (Array.isArray(req.body)) {
            events = req.body.map((event) => event.event)
        } else {
            events = [req.body.event]
        }
        events.forEach((evt) => console.log(`[Event] ${evt}`))
        eventStore.push(req.body)
    } else {
        console.error('Received event request without body', req.url)
    }
    res.status(200)
        .set({
            'Content-Type': 'application/json',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Credentials': 'true',
        })
        .send(JSON.stringify({ status: 1 }))
})

app.use(/^\/ses/, (req, res) => {
    res.status(200)
        .set({
            'Content-Type': 'application/json',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Credentials': 'true',
        })
        .send(JSON.stringify({ status: 1 }))
})

app.listen(port, () => {
    console.log(`Mock server is running on http://localhost:${port}`)
}).on('error', (error) => {
    console.error(`Error starting mock server: ${error.message}`)
})
