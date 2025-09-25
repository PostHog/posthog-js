#!/usr/bin/env node
import { execSync, spawn } from 'child_process'
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BROWSER_ROOT = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(BROWSER_ROOT, '../../')
const TEMP_DIR = path.join(BROWSER_ROOT, '.backwards-compatibility-test')
const DIST_DIR = path.join(BROWSER_ROOT, 'dist')

function getLastNReleases(count = 5) {
    try {
        // Get the last N release tags for posthog-js
        const tags = execSync(`git tag -l "posthog-js@*" --sort=-version:refname | head -${count}`, {
            encoding: 'utf-8',
            cwd: REPO_ROOT,
            stdio: 'pipe'
        }).trim().split('\n').filter(tag => tag)

        return tags.map(tag => {
            const version = tag.replace('posthog-js@', '')
            const commit = execSync(`git rev-parse ${tag}`, {
                encoding: 'utf-8',
                cwd: REPO_ROOT,
                stdio: 'pipe'
            }).trim()

            return { version, commit, tag }
        })
    } catch (error) {
        log(`Error getting release tags: ${error.message}`)
        // Fallback to hardcoded releases if git command fails
        return [
            { version: '1.268.0', commit: '35a5d5b9669e6dcce0dcab2e2b9100271577d634', tag: 'posthog-js@1.268.0' },
            { version: '1.268.1', commit: 'a242ec83b1bbcddc34180ce2c38bc771e84849e9', tag: 'posthog-js@1.268.1' },
            { version: '1.268.2', commit: '09906f47373bf4c04cc50189dd17b3ca9e933efd', tag: 'posthog-js@1.268.2' },
            { version: '1.268.3', commit: 'f64a67052cbd7610bd0d98d5018f5c4be250c905', tag: 'posthog-js@1.268.3' },
            { version: '1.268.4', commit: '497bd21dab3f2d3d03c5d0882d00f49214e98b07', tag: 'posthog-js@1.268.4' },
        ]
    }
}

function log(message) {
    console.log(`[BACKCOMPAT] ${message}`)
}

function execCommand(command, options = {}) {
    log(`Executing: ${command}`)
    return execSync(command, {
        stdio: 'inherit',
        cwd: options.cwd || REPO_ROOT,
        ...options
    })
}

function createTempDir() {
    if (existsSync(TEMP_DIR)) {
        rmSync(TEMP_DIR, { recursive: true })
    }
    mkdirSync(TEMP_DIR, { recursive: true })
}

function backupCurrentDistFile() {
    const arrayFullJsPath = path.join(DIST_DIR, 'array.full.js')
    const backupPath = path.join(TEMP_DIR, 'array.full.js.backup')

    if (existsSync(arrayFullJsPath)) {
        copyFileSync(arrayFullJsPath, backupPath)
        log('✓ Backed up current array.full.js')
    } else {
        log('⚠️  No current array.full.js found to backup')
    }
}

function getCurrentBranch() {
    return execSync('git branch --show-current', {
        encoding: 'utf-8',
        cwd: REPO_ROOT
    }).trim()
}

function checkGitStatus() {
    try {
        const status = execSync('git status --porcelain', {
            encoding: 'utf-8',
            cwd: REPO_ROOT,
            stdio: 'pipe'
        }).trim()

        if (status) {
            log('⚠️  You have uncommitted changes:')
            log(status)
            log('Please commit or stash your changes before running this script')
            process.exit(1)
        }
    } catch (error) {
        log('Error checking git status:', error.message)
        process.exit(1)
    }
}

function buildArrayJsForCommit(version, commit) {
    log(`Building array.js for version ${version} (commit: ${commit})`)

    const currentBranch = getCurrentBranch()
    const tempBranch = `temp-build-${version}`

    try {
        // Create and checkout temporary branch at the specific commit
        execCommand(`git checkout -b ${tempBranch} ${commit}`)

        // Navigate to packages/browser and build
        process.chdir(BROWSER_ROOT)

        // Install dependencies (in case they changed)
        execCommand('pnpm install')

        // Build the project
        execCommand('pnpm build')

        // Copy the built array.js to our temp directory
        const builtArrayJs = path.join(BROWSER_ROOT, 'dist', 'array.js')
        const targetPath = path.join(TEMP_DIR, `array-${version}.js`)

        if (existsSync(builtArrayJs)) {
            copyFileSync(builtArrayJs, targetPath)
            log(`✓ Built and copied array.js for version ${version}`)
        } else {
            throw new Error(`Built array.js not found at ${builtArrayJs}`)
        }

    } catch (error) {
        log(`✗ Failed to build array.js for version ${version}: ${error.message}`)
        throw error
    } finally {
        // Always return to original directory and branch
        process.chdir(REPO_ROOT)
        execCommand(`git checkout ${currentBranch}`)

        // Clean up temporary branch
        try {
            execCommand(`git branch -D ${tempBranch}`)
        } catch (e) {
            // Ignore cleanup errors
        }
    }
}

function setupDistFiles(arrayJsVersion) {
    log(`Setting up dist files with array.js version ${arrayJsVersion}`)

    // Copy the specific version of array.js to dist/array.full.js (which Playwright serves)
    const sourceFile = path.join(TEMP_DIR, `array-${arrayJsVersion}.js`)
    const targetFile = path.join(DIST_DIR, 'array.full.js')

    if (!existsSync(sourceFile)) {
        throw new Error(`Array.js for version ${arrayJsVersion} not found at ${sourceFile}`)
    }

    copyFileSync(sourceFile, targetFile)
    log(`✓ Copied array-${arrayJsVersion}.js to dist/array.full.js`)
}

function restoreDistFiles() {
    log('Restoring original dist files')

    const backupPath = path.join(TEMP_DIR, 'array.full.js.backup')
    const arrayFullJsPath = path.join(DIST_DIR, 'array.full.js')

    if (existsSync(backupPath)) {
        copyFileSync(backupPath, arrayFullJsPath)
        log('✓ Restored original array.full.js')
    } else {
        log('⚠️  No backup found to restore')
    }
}

function runPlaywrightTests(isCI = false) {
    log('Running Playwright tests')

    return new Promise((resolve, reject) => {
        const args = ['playwright']
        if (isCI || process.env.CI) {
            // CI-friendly options: no interactive UI, no HTML report server
            args.push('--reporter=dot')
        }

        const playwrightProcess = spawn('pnpm', args, {
            cwd: BROWSER_ROOT,
            stdio: isCI ? 'pipe' : 'inherit'
        })

        playwrightProcess.on('close', (code) => {
            if (code === 0) {
                log('✓ Playwright tests passed')
                resolve()
            } else {
                log(`✗ Playwright tests failed with code ${code}`)
                reject(new Error(`Playwright tests failed with exit code ${code}`))
            }
        })
    })
}

async function runTestsForAllVersions(releases, isCI = false) {
    const results = []

    for (const release of releases) {
        log(`\n=== Testing version ${release.version} ===`)

        try {
            // Set up dist files with this version's array.js
            setupDistFiles(release.version)

            // Run tests
            await runPlaywrightTests(isCI)

            results.push({
                version: release.version,
                status: 'PASS',
                error: null
            })

            log(`✓ Version ${release.version} PASSED`)

        } catch (error) {
            results.push({
                version: release.version,
                status: 'FAIL',
                error: error.message
            })

            log(`✗ Version ${release.version} FAILED: ${error.message}`)
        }
    }

    return results
}

function printSummary(results) {
    log('\n=== BACKWARDS COMPATIBILITY TEST SUMMARY ===')

    results.forEach(result => {
        const status = result.status === 'PASS' ? '✓' : '✗'
        log(`${status} ${result.version}: ${result.status}`)
        if (result.error) {
            log(`    Error: ${result.error}`)
        }
    })

    const passCount = results.filter(r => r.status === 'PASS').length
    const totalCount = results.length

    log(`\nSummary: ${passCount}/${totalCount} versions passed`)

    if (passCount === totalCount) {
        log('🎉 All versions are backwards compatible!')
        return true
    } else {
        log('⚠️  Some versions have backwards compatibility issues')
        return false
    }
}

function cleanup() {
    log('Cleaning up temporary files')

    // Restore original dist files
    restoreDistFiles()

    // Remove temp directory
    if (existsSync(TEMP_DIR)) {
        rmSync(TEMP_DIR, { recursive: true })
    }
}

function printUsage() {
    console.log(`
Usage: node backwards-compatibility-test.mjs [OPTIONS]

Options:
  --count=N     Test against the last N releases (default: 5)
  --ci          Run in CI mode (non-interactive, no HTML report server)
  --help        Show this help message

Examples:
  node backwards-compatibility-test.mjs                # Test last 5 releases (interactive)
  node backwards-compatibility-test.mjs --ci           # Test last 5 releases (CI mode)
  node backwards-compatibility-test.mjs --count=3      # Test last 3 releases
  node backwards-compatibility-test.mjs --count=10 --ci # Test 10 releases in CI mode
`)
}

async function main() {
    try {
        // Parse command line arguments
        const args = process.argv.slice(2)

        if (args.includes('--help')) {
            printUsage()
            process.exit(0)
        }

        const countArg = args.find(arg => arg.startsWith('--count='))
        const releaseCount = countArg ? parseInt(countArg.split('=')[1]) : 5
        const isCI = args.includes('--ci') || !!process.env.CI

        log('Starting backwards compatibility test')

        // Get releases to test
        const releases = getLastNReleases(releaseCount)
        log(`Found ${releases.length} releases to test: ${releases.map(r => r.version).join(', ')}`)

        // Check for uncommitted changes
        checkGitStatus()

        // Create temporary directory for storing built files
        createTempDir()

        // Backup current dist files
        backupCurrentDistFile()

        // Build array.js for each version
        log('\n=== Building array.js for each version ===')
        for (const release of releases) {
            buildArrayJsForCommit(release.version, release.commit)
        }

        // Run tests for each version
        log('\n=== Running tests for each version ===')
        const results = await runTestsForAllVersions(releases, isCI)

        // Print summary
        const allPassed = printSummary(results)

        // Exit with appropriate code
        process.exit(allPassed ? 0 : 1)


    } catch (error) {
        log(`Fatal error: ${error.message}`)
        process.exit(1)
    } finally {
        cleanup()
    }
}

// Handle cleanup on exit
process.on('exit', cleanup)
process.on('SIGINT', () => {
    cleanup()
    process.exit(1)
})

// Run the main function
main().catch(error => {
    log(`Unhandled error: ${error.message}`)
    cleanup()
    process.exit(1)
})