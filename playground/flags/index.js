#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef, no-console */
/**
 * Interactive demo selector for PostHog flags playground
 */

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

// Load environment variables from .env file
try {
    require('dotenv').config()
} catch (e) {
    // dotenv not available, try to read .env manually
    try {
        const envPath = path.join(__dirname, '.env')
        const envFile = fs.readFileSync(envPath, 'utf8')

        envFile.split('\n').forEach((line) => {
            const [key, ...valueParts] = line.split('=')
            if (key && !key.startsWith('#') && valueParts.length > 0) {
                const value = valueParts.join('=').trim()
                if (!process.env[key]) {
                    process.env[key] = value
                }
            }
        })
    } catch (err) {
        console.warn('⚠️  Could not load .env file:', err.message)
    }
}

// Available demos
const demos = [
    {
        name: 'Flag Dependencies Demo',
        description: 'Test flag dependencies with local evaluation',
        file: 'flag-dependencies-demo.js',
        key: '1',
    },
    {
        name: 'Remote Config Demo',
        description: 'Test PostHog remote config endpoint',
        file: 'remote-config-demo.js',
        key: '2',
    },
]

function checkEnvFile() {
    const envPath = path.join(__dirname, '.env')
    if (!fs.existsSync(envPath)) {
        console.log('📋 Setup required:')
        console.log('   1. Copy .env.example to .env')
        console.log('   2. Update .env with your PostHog credentials')
        console.log()
        console.log('   cp .env.example .env')
        console.log()
        return false
    }
    return true
}

function showMenu() {
    console.log('🎯 PostHog Flags Playground')
    console.log('============================')
    console.log()

    if (!checkEnvFile()) {
        return
    }

    console.log('Available demos:')
    console.log()

    demos.forEach((demo) => {
        console.log(`${demo.key}. ${demo.name}`)
        console.log(`   ${demo.description}`)
        console.log()
    })

    console.log('Select a demo (1-' + demos.length + ') or press Ctrl+C to exit:')
}

function runDemo(demo) {
    console.log(`🚀 Running ${demo.name}...`)
    console.log('='.repeat(50))
    console.log()

    const child = spawn('node', [demo.file], {
        cwd: __dirname,
        stdio: 'inherit',
        env: process.env,
    })

    child.on('close', (code) => {
        console.log()
        console.log('='.repeat(50))
        if (code === 0) {
            console.log('✅ Demo completed successfully!')
        } else {
            console.log(`❌ Demo exited with code ${code}`)
        }
        console.log()
        promptForNext()
    })

    child.on('error', (error) => {
        console.error('❌ Error running demo:', error.message)
        promptForNext()
    })
}

function promptForNext() {
    const readline = require('readline')
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    })

    rl.question('Run another demo? (y/n): ', (answer) => {
        rl.close()
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
            main()
        } else {
            console.log('👋 Thanks for using PostHog Flags Playground!')
            process.exit(0)
        }
    })
}

function main() {
    showMenu()

    if (!checkEnvFile()) {
        return
    }

    const readline = require('readline')
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    })

    rl.question('> ', (choice) => {
        rl.close()

        const demo = demos.find((d) => d.key === choice.trim())

        if (demo) {
            runDemo(demo)
        } else {
            console.log('❌ Invalid choice. Please select 1-' + demos.length)
            console.log()
            main()
        }
    })
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Goodbye!')
    process.exit(0)
})

if (require.main === module) {
    main()
}

module.exports = { demos, runDemo }
