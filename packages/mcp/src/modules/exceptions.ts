import type { ChainedErrorData, ErrorData, StackFrame } from '../types'

// Lazy-loaded fs module for context_line extraction (Node.js only).
// Edge environments don't have filesystem access — we fall through to
// returning frames without context_line, never breaking exception capture.
let fsModule: typeof import('node:fs') | null = null
let fsInitAttempted = false

function getFsSync(): typeof import('node:fs') | null {
  if (!fsInitAttempted) {
    fsInitAttempted = true
    try {
      // `require` is only available in CJS at runtime. In an ESM build, this
      // line throws — we catch and just disable context_line extraction. Using
      // a dynamic identifier prevents bundlers from trying to inline `fs`.
      const req: ((id: string) => unknown) | undefined =
        typeof require === 'function' ? (require as (id: string) => unknown) : undefined
      fsModule = req ? (req('node:fs') as typeof import('node:fs')) : null
    } catch {
      fsModule = null
    }
  }
  return fsModule
}

// Maximum number of exceptions to capture in a cause chain
const MAX_EXCEPTION_CHAIN_DEPTH = 10

// Maximum number of stack frames to capture per exception
const MAX_STACK_FRAMES = 50

const LOCATION_WITH_LINE_COLUMN_REGEX = /^(.+):(\d+):(\d+)$/
const WINDOWS_DRIVE_PREFIX_REGEX = /^[A-Za-z]:/
const WINDOWS_ABSOLUTE_PATH_REGEX = /^[A-Za-z]:\\/
const WINDOWS_ABSOLUTE_SLASH_PATH_REGEX = /^[A-Za-z]:[/]/
const UNIX_USER_HOME_REGEX = /^\/Users\/[^/]+\//
const LINUX_USER_HOME_REGEX = /^\/home\/[^/]+\//
const WINDOWS_USER_HOME_REGEX = /^[A-Za-z]:[\\/]Users[\\/][^\\/]+[\\/]/
const DEPLOYMENT_PREFIX_REGEXES = [
  /^\/var\/www\/[^/]+\//, // Apache/nginx: /var/www/myapp/
  /^\/var\/task\//, // AWS Lambda: /var/task/
  /^\/usr\/src\/app\//, // Docker: /usr/src/app/
  /^\/app\//, // Heroku, Docker, generic: /app/
  /^\/opt\/[^/]+\//, // Optional software: /opt/myapp/
  /^\/srv\/[^/]+\//, // Service data: /srv/myapp/
]

interface ErrorWithCause extends Error {
  cause?: unknown
}

interface CallToolContentPart {
  text?: unknown
  type?: unknown
}

interface CallToolResult {
  content: unknown[]
  isError: unknown
}

/**
 * Captures detailed exception information including stack traces and cause chains.
 *
 * This function extracts error metadata (type, message, stack trace) and recursively
 * unwraps Error.cause chains. It parses V8 stack traces into structured frames and
 * detects whether each frame is user code (in_app: true) or library code (in_app: false).
 *
 * @param error - The error to capture (can be Error, string, object, or any value)
 * @param contextStack - Optional Error object to use for stack context (for validation errors)
 * @returns ErrorData object with structured error information
 */
export function captureException(error: unknown, contextStack?: Error): ErrorData {
  // Handle CallToolResult objects (SDK 1.21.0+ converts errors to these)
  if (isCallToolResult(error)) {
    return captureCallToolResultError(error, contextStack)
  }

  // Handle non-Error objects
  if (!(error instanceof Error)) {
    return {
      message: stringifyNonError(error),
      type: undefined,
      platform: 'javascript',
    }
  }

  const errorData: ErrorData = {
    message: error.message || '',
    type: error.name || error.constructor?.name || undefined,
    platform: 'javascript',
  }

  // Capture stack trace if available
  if (error.stack) {
    errorData.stack = error.stack
    errorData.frames = parseV8StackTrace(error.stack)
  }

  // Unwrap Error.cause chain
  const chainedErrors = unwrapErrorCauses(error)
  if (chainedErrors.length > 0) {
    errorData.chained_errors = chainedErrors
  }

  return errorData
}

/**
 * Parses V8 stack trace string into structured StackFrame array.
 *
 * V8 stack traces have the format:
 *   Error: message
 *   at functionName (filename:line:col)
 *   at Object.method (filename:line:col)
 *   ...
 *
 * This function handles various V8 format variations including:
 * - Regular functions: "at functionName (file:10:5)"
 * - Anonymous functions: "at file:10:5"
 * - Async functions: "at async functionName (file:10:5)"
 * - Object methods: "at Object.method (file:10:5)"
 * - Native code: "at Array.map (native)"
 *
 * @param stackTrace - Raw V8 stack trace string from Error.stack
 * @returns Array of parsed StackFrame objects (limited to MAX_STACK_FRAMES)
 */
function parseV8StackTrace(stackTrace: string): StackFrame[] {
  const frames: StackFrame[] = []
  const lines = stackTrace.split('\n')

  for (const line of lines) {
    // Skip the first line (error message) and empty lines
    if (!line.trim().startsWith('at ')) {
      continue
    }

    const frame = parseV8StackFrame(line.trim())
    if (frame) {
      addContextToFrame(frame)
      frames.push(frame)
    }

    // Limit number of frames
    if (frames.length >= MAX_STACK_FRAMES) {
      break
    }
  }

  return frames
}

/**
 * Adds context_line to a stack frame by reading the source file.
 *
 * This function extracts the line of code where the error occurred by:
 * 1. Reading the source file using abs_path
 * 2. Extracting the line at the specified line number
 * 3. Setting the context_line field on the frame
 *
 * Only extracts context for user code (in_app: true)
 * If the file cannot be read or the line number is invalid, context_line remains undefined.
 *
 * @param frame - The StackFrame to add context to (modified in place)
 * @returns The modified StackFrame
 */
function addContextToFrame(frame: StackFrame): StackFrame {
  if (!(frame.in_app && frame.abs_path && frame.lineno)) {
    return frame
  }

  // Get fs module lazily - returns null in edge environments
  const fs = getFsSync()
  if (!fs) {
    return frame // File reading not available in this environment
  }

  try {
    const source = fs.readFileSync(frame.abs_path, 'utf8')
    const lines = source.split('\n')
    const lineIndex = frame.lineno - 1 // Convert to 0-based index

    if (lineIndex >= 0 && lineIndex < lines.length) {
      frame.context_line = lines[lineIndex]
    }
  } catch {
    // File not found or not readable - silently skip
  }

  return frame
}

/**
 * Parses a location string from a V8 stack frame.
 *
 * Handles different location formats:
 * - "fileName:lineNumber:columnNumber" - normal file location
 * - "eval at functionName (location)" - eval'd code (recursively unwraps)
 * - "native" - V8 internal code
 * - "unknown location" - location unavailable
 *
 * @param location - Location string from stack frame
 * @returns Object with filename, abs_path, and optional lineno/colno, or null if unparseable
 */
function parseLocation(location: string): {
  filename: string
  abs_path: string
  lineno?: number
  colno?: number
} | null {
  // Handle special cases first
  if (location === 'native') {
    return { filename: 'native', abs_path: 'native' }
  }

  if (location === 'unknown location') {
    return { filename: '<unknown>', abs_path: '<unknown>' }
  }

  // Handle eval locations
  if (location.startsWith('eval at ')) {
    return parseEvalOrigin(location)
  }

  // Handle normal location format: fileName:lineNumber:columnNumber
  const match = location.match(LOCATION_WITH_LINE_COLUMN_REGEX)
  if (match) {
    const [, filename, lineStr, colStr] = match
    return {
      filename: makeRelativePath(filename),
      abs_path: filename,
      lineno: Number.parseInt(lineStr, 10),
      colno: Number.parseInt(colStr, 10),
    }
  }

  return null
}

/**
 * Recursively unwraps eval location chains to extract the underlying file location.
 *
 * Eval locations have the format: "eval at functionName (location), <anonymous>:line:col"
 * where location can be another eval or a file location.
 *
 * V8 formats:
 * - "eval at Bar.z (myscript.js:10:3)" → extract myscript.js:10:3
 * - "eval at Foo (eval at Bar (file.js:10:3)), <anonymous>:5:2" → extract file.js:10:3
 *
 * @param evalLocation - Eval location string starting with "eval at "
 * @returns Object with extracted file location, or null if unparseable
 */
function parseEvalOrigin(evalLocation: string): {
  filename: string
  abs_path: string
  lineno?: number
  colno?: number
} | null {
  // V8 format: "eval at functionName (parentLocation), <anonymous>:line:col"
  // or simpler: "eval at functionName (parentLocation)"
  //
  // Strategy: Find balanced parentheses to extract the parent location,
  // then recursively parse it to find the actual file.

  // First, check if there's a comma separating eval chain from eval code location
  // Format: "eval at FUNC (...), <anonymous>:line:col"
  // We want to extract just the "eval at FUNC (...)" part
  let evalChainPart = evalLocation
  const commaIndex = findCommaAfterBalancedParens(evalLocation)
  if (commaIndex !== -1) {
    evalChainPart = evalLocation.slice(0, commaIndex)
  }

  const innerLocation = extractTrailingParenthesizedContent(evalChainPart)
  if (!(innerLocation && evalChainPart.startsWith('eval at '))) {
    return null
  }

  // Recursively parse the inner location
  if (innerLocation.startsWith('eval at ')) {
    return parseEvalOrigin(innerLocation)
  }

  // Base case: parse as normal location
  const locationMatch = innerLocation.match(LOCATION_WITH_LINE_COLUMN_REGEX)
  if (locationMatch) {
    const [, filename, lineStr, colStr] = locationMatch
    return {
      filename: makeRelativePath(filename),
      abs_path: filename,
      lineno: Number.parseInt(lineStr, 10),
      colno: Number.parseInt(colStr, 10),
    }
  }

  return null
}

/**
 * Finds the index of the comma that appears after balanced parentheses.
 *
 * For "eval at f (eval at g (x)), <anonymous>:1:2", returns the index of the comma
 * after the closing ")" and before "<anonymous>".
 *
 * @param str - String to search
 * @returns Index of comma, or -1 if not found
 */
function findCommaAfterBalancedParens(str: string): number {
  let depth = 0
  let foundOpenParen = false

  for (let i = 0; i < str.length; i++) {
    if (str[i] === '(') {
      depth++
      foundOpenParen = true
    } else if (str[i] === ')') {
      depth--
      if (depth === 0 && foundOpenParen) {
        // Found the closing paren of the eval at (...) part
        for (let j = i + 1; j < str.length; j++) {
          if (str[j] === ',') {
            return j
          }
          if (str[j] !== ' ') {
            // Non-comma, non-space character found, no comma separator
            return -1
          }
        }
        return -1
      }
    }
  }

  return -1
}

function extractTrailingParenthesizedContent(value: string): string | null {
  const trimmedValue = value.trim()
  if (!trimmedValue.endsWith(')')) {
    return null
  }

  const openingParenIndex = findMatchingOpeningParen(trimmedValue)
  if (openingParenIndex === -1) {
    return null
  }

  return trimmedValue.slice(openingParenIndex + 1, -1)
}

function findMatchingOpeningParen(value: string): number {
  let depth = 0

  for (let index = value.length - 1; index >= 0; index--) {
    const char = value[index]
    if (char === ')') {
      depth++
    } else if (char === '(') {
      depth--
      if (depth === 0) {
        return index
      }
    }
  }

  return -1
}

/**
 * Parses a single V8 stack frame line into a StackFrame object.
 *
 * Handles multiple V8 stack frame formats:
 * - "at functionName (filename:line:col)"
 * - "at filename:line:col" (top-level code)
 * - "at async functionName (filename:line:col)"
 * - "at Object.method (filename:line:col)"
 * - "at Module._compile (node:internal/...)" (internal modules)
 * - "at functionName (eval at ...)" (eval'd code)
 * - "at functionName (native)" (native code)
 *
 * @param line - Single line from V8 stack trace (trimmed, starts with "at ")
 * @returns Parsed StackFrame or null if line cannot be parsed
 */
function parseV8StackFrame(line: string): StackFrame | null {
  // Remove "at " prefix
  const withoutAt = line.slice(3)

  // Try to extract function name and location
  // Format 1: "functionName (location)"
  // Location can be: filename:line:col, eval at ..., native, unknown location
  const location = extractTrailingParenthesizedContent(withoutAt)
  if (location) {
    const openingParenIndex = findMatchingOpeningParen(withoutAt.trim())
    const functionName = withoutAt.slice(0, openingParenIndex).trim()
    const parsedLocation = parseLocation(location)

    if (functionName && parsedLocation) {
      return {
        function: functionName,
        filename: parsedLocation.filename,
        abs_path: parsedLocation.abs_path,
        lineno: parsedLocation.lineno,
        colno: parsedLocation.colno,
        in_app: isInApp(parsedLocation.abs_path),
      }
    }
  }

  // Format 2: "location" (no function name, top-level code)
  // Try to parse as location directly
  const parsedLocation = parseLocation(withoutAt)
  if (parsedLocation) {
    return {
      function: '<anonymous>',
      filename: parsedLocation.filename,
      abs_path: parsedLocation.abs_path,
      lineno: parsedLocation.lineno,
      colno: parsedLocation.colno,
      in_app: isInApp(parsedLocation.abs_path),
    }
  }

  // Format 3: Unparseable
  // Fallback for formats we don't recognize
  return {
    function: withoutAt,
    filename: '<unknown>',
    in_app: false,
  }
}

/**
 * Determines if a file path represents user code (in_app: true) or library code (in_app: false).
 *
 * Library code is identified by:
 * - Paths containing "/node_modules/"
 * - Node.js internal modules (e.g., "node:internal/...")
 * - Native code
 *
 * @param filename - File path from stack frame
 * @returns true if user code, false if library code
 */
function isInApp(filename: string): boolean {
  // Exclude node_modules
  if (filename.includes('/node_modules/') || filename.includes('\\node_modules\\')) {
    return false
  }

  // Exclude Node.js internal modules (node:internal/...)
  if (filename.startsWith('node:')) {
    return false
  }

  // Exclude native code
  if (filename === 'native' || filename === '<unknown>') {
    return false
  }

  return true
}

/**
 * Normalizes URL schemes to regular file paths.
 *
 * Handles file:// URLs commonly seen in ESM modules and local testing:
 * - "file:///Users/john/project/src/index.ts" → "/Users/john/project/src/index.ts"
 * - "file:///C:/projects/app/src/index.ts" → "C:/projects/app/src/index.ts"
 *
 * @param filename - File path that may be a file:// URL
 * @returns Clean file path without URL scheme
 */
function normalizeUrl(filename: string): string {
  // Handle file:// URLs (common in ESM modules and local testing)
  if (filename.startsWith('file://')) {
    let result = filename.slice(7) // Remove "file://"

    // Ensure Unix paths start with /
    if (!(result.startsWith('/') || WINDOWS_DRIVE_PREFIX_REGEX.test(result))) {
      result = `/${result}`
    }

    return result
  }

  return filename
}

/**
 * Normalizes Node.js internal module paths for consistent error grouping.
 *
 * Examples:
 * - "node:internal/modules/cjs/loader" → "node:internal"
 * - "node:fs/promises" → "node:fs"
 * - "node:fs" → "node:fs" (unchanged)
 *
 * @param filename - File path that may be a Node.js internal module
 * @returns Simplified module path or original filename
 */
function normalizeNodeInternals(filename: string): string {
  if (filename.startsWith('node:internal')) {
    return 'node:internal'
  }

  if (filename.startsWith('node:')) {
    // Extract just the module name: node:fs/promises → node:fs
    const parts = filename.split('/')
    return parts[0]
  }

  return filename
}

/**
 * Strips user-specific and system path prefixes.
 *
 * Removes prefixes like:
 * - /Users/username/ → ~/
 * - /home/username/ → ~/
 * - C:\Users\username\ → ~\
 * - C:/Users/username/ → ~/ (mixed separators)
 *
 * @param path - File path to normalize
 * @returns Path with system prefixes removed
 */
function stripSystemPrefixes(path: string): string {
  let result = path

  // Unix/macOS: /Users/username/
  result = result.replace(UNIX_USER_HOME_REGEX, '~/')

  // Linux: /home/username/
  result = result.replace(LINUX_USER_HOME_REGEX, '~/')

  // Windows: C:\Users\username\ or C:/Users/username/ (with any separator)
  result = result.replace(WINDOWS_USER_HOME_REGEX, '~/')

  return result
}

/**
 * Normalizes node_modules paths to be consistent across deployments.
 *
 * Extracts only the package-relative portion of the path:
 * - /Users/john/project/node_modules/express/lib/router.js → node_modules/express/lib/router.js
 * - /app/node_modules/@scope/pkg/index.js → node_modules/@scope/pkg/index.js
 *
 * @param path - File path that may contain node_modules
 * @returns Normalized node_modules path or original path
 */
function normalizeNodeModules(path: string): string {
  // Find the last occurrence of /node_modules/ or \node_modules\
  const unixIndex = path.lastIndexOf('/node_modules/')
  const winIndex = path.lastIndexOf('\\node_modules\\')

  if (unixIndex !== -1) {
    return path.slice(unixIndex + 1) // +1 to exclude leading slash
  }

  if (winIndex !== -1) {
    return path.slice(winIndex + 1).replace(/\\/g, '/')
  }

  return path
}

/**
 * Strips common deployment-specific path prefixes.
 *
 * Removes prefixes like:
 * - /var/www/app/ → ""
 * - /app/ → ""
 * - /opt/project/ → ""
 * - /var/task/ → "" (AWS Lambda)
 * - /usr/src/app/ → "" (Docker)
 *
 * @param path - File path to normalize
 * @returns Path with deployment prefixes removed
 */
function stripDeploymentPaths(path: string): string {
  let result = path

  for (const prefix of DEPLOYMENT_PREFIX_REGEXES) {
    result = result.replace(prefix, '')
  }

  return result
}

/**
 * Finds project-relative path using common project boundary markers.
 *
 * Looks for markers like /src/, /lib/, /dist/, /build/ and extracts the path
 * from that marker onwards:
 * - /Users/john/project/src/components/Button.tsx → src/components/Button.tsx
 * - /app/dist/index.js → dist/index.js
 *
 * Priority order: looks for primary markers first (src, lib, dist, build),
 * then secondary markers. Uses the highest-priority marker found.
 *
 * @param path - File path to search for project boundaries
 * @returns Project-relative path or original path if no marker found
 */
function findProjectPath(path: string): string {
  // Project boundary markers in priority order
  // Primary markers (most likely to be project root)
  const primaryMarkers = ['/src/', '/lib/', '/dist/', '/build/']

  // Secondary markers (could be subdirectories)
  const secondaryMarkers = ['/app/', '/components/', '/pages/', '/api/', '/utils/', '/services/', '/modules/']

  // Check primary markers first
  for (const marker of primaryMarkers) {
    const index = path.lastIndexOf(marker)
    if (index !== -1) {
      return path.slice(index + 1) // +1 to remove leading slash
    }
  }

  // If no primary marker, check secondary markers
  for (const marker of secondaryMarkers) {
    const index = path.lastIndexOf(marker)
    if (index !== -1) {
      return path.slice(index + 1)
    }
  }

  return path
}

/**
 * Converts absolute file paths to normalized relative paths for consistent error grouping.
 *
 * This function performs comprehensive path normalization to ensure errors from the same
 * code location group together regardless of deployment environment, user directories,
 * or system-specific paths. The original absolute path is always preserved in abs_path.
 *
 * Normalization steps:
 * 1. Normalize URL schemes (file://, etc.) - must be first to strip URL prefixes
 * 2. Preserve special paths (already relative, Node internals, etc.)
 * 3. Normalize path separators to forward slashes (for consistent processing)
 * 4. Normalize Node.js internal modules (node:internal/*, node:fs/*)
 * 5. Normalize node_modules paths to package-relative format
 * 6. Strip user home directories (/Users/*, /home/*, C:\Users\*)
 * 7. Strip deployment-specific paths (/var/www/*, /app/, AWS Lambda, Docker)
 * 8. Strip current working directory
 * 9. Find project boundaries (/src/, /lib/, /dist/, etc.)
 * 10. Remove leading slashes for clean relative paths
 *
 * @param filename - Absolute or relative file path from stack trace
 * @returns Normalized relative path for error grouping
 *
 * @example
 * makeRelativePath('/Users/john/project/src/index.ts')
 * // Returns: 'src/index.ts'
 *
 * @example
 * makeRelativePath('/home/ubuntu/app/node_modules/express/lib/router.js')
 * // Returns: 'node_modules/express/lib/router.js'
 *
 * @example
 * makeRelativePath('/var/www/myapp/dist/server.js')
 * // Returns: 'dist/server.js'
 *
 * @example
 * makeRelativePath('node:internal/modules/cjs/loader')
 * // Returns: 'node:internal'
 *
 * @example
 * makeRelativePath('C:\\Users\\John\\projects\\myapp\\src\\index.ts')
 * // Returns: 'src/index.ts'
 */
function makeRelativePath(filename: string): string {
  let result = filename

  // Step 1: Normalize URL schemes (file://, etc.)
  result = normalizeUrl(result)

  // Step 2: Handle already-relative paths and special cases
  if (!(result.startsWith('/') || WINDOWS_ABSOLUTE_PATH_REGEX.test(result))) {
    // Already relative or special path (native, <unknown>, etc.)
    // Still normalize Node internals
    if (result.startsWith('node:')) {
      return normalizeNodeInternals(result)
    }
    return result
  }

  // Step 3: Normalize path separators early for consistent processing
  result = result.replace(/\\/g, '/')

  // Step 4: Normalize Node.js internal modules (should be rare at this point)
  if (result.startsWith('node:')) {
    return normalizeNodeInternals(result)
  }

  // Step 5: Handle node_modules specially - preserve package structure
  if (result.includes('/node_modules/')) {
    return normalizeNodeModules(result)
  }

  // Step 6: Strip user home directories
  result = stripSystemPrefixes(result)

  // Step 7: Strip deployment-specific paths
  result = stripDeploymentPaths(result)

  // Step 8: Strip current working directory (if available)
  // process.cwd() may not be available in edge environments
  let cwd: string | null = null
  try {
    if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
      cwd = process.cwd()
    }
  } catch {
    // process.cwd() not available in this environment
  }

  if (cwd && result.startsWith(cwd)) {
    result = result.slice(cwd.length + 1) // +1 to remove leading /
  }

  // Step 9: Find project boundaries if still absolute-looking
  // Also apply to tilde paths that might have project markers after the tilde
  if (result.startsWith('/') || WINDOWS_ABSOLUTE_SLASH_PATH_REGEX.test(result)) {
    result = findProjectPath(result)
  } else if (result.startsWith('~')) {
    // For tilde paths, strip the tilde and find markers in the remaining path
    const withoutTilde = result.slice(2) // Remove ~/
    const absoluteWithoutTilde = `/${withoutTilde}`
    const projectPath = findProjectPath(absoluteWithoutTilde)
    // If a marker was found (path changed), use it; otherwise keep the tilde version
    if (projectPath !== absoluteWithoutTilde) {
      result = projectPath
    }
  }

  // Step 10: Remove leading slash if present (prefer relative paths)
  if (result.startsWith('/')) {
    result = result.slice(1)
  }

  return result
}

/**
 * Recursively unwraps Error.cause chain and returns array of chained errors.
 *
 * Error.cause is a standard JavaScript feature that allows chaining errors:
 *   const cause = new Error("Root cause");
 *   const error = new Error("Wrapper error", { cause });
 *
 * This function extracts all errors in the cause chain up to MAX_EXCEPTION_CHAIN_DEPTH.
 *
 * @param error - Error object to unwrap
 * @returns Array of ChainedErrorData objects representing the error chain
 */
function unwrapErrorCauses(error: Error): ChainedErrorData[] {
  const chainedErrors: ChainedErrorData[] = []
  const seenErrors = new Set<Error>()
  let currentError: unknown = (error as ErrorWithCause).cause
  let depth = 0

  while (currentError && depth < MAX_EXCEPTION_CHAIN_DEPTH) {
    // If cause is not an Error, stringify it and stop
    if (!(currentError instanceof Error)) {
      chainedErrors.push({
        message: stringifyNonError(currentError),
        type: undefined,
      })
      break
    }

    // Check for circular reference
    if (seenErrors.has(currentError)) {
      break
    }
    seenErrors.add(currentError)

    const chainedErrorData: ChainedErrorData = {
      message: currentError.message || '',
      type: currentError.name || currentError.constructor?.name || 'Error',
    }

    if (currentError.stack) {
      chainedErrorData.stack = currentError.stack
      chainedErrorData.frames = parseV8StackTrace(currentError.stack)
    }

    chainedErrors.push(chainedErrorData)

    // Move to next cause in chain
    currentError = (currentError as ErrorWithCause).cause
    depth++
  }

  return chainedErrors
}

/**
 * Detects if a value is a CallToolResult object (SDK 1.21.0+ error format).
 *
 * SDK 1.21.0+ converts errors to CallToolResult format:
 * { content: [{ type: "text", text: "error message" }], isError: true }
 *
 * @param value - Value to check
 * @returns True if value is a CallToolResult object
 */
function isCallToolResult(value: unknown): value is CallToolResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    'isError' in value &&
    'content' in value &&
    Array.isArray((value as { content?: unknown }).content)
  )
}

function isTextContentPart(value: unknown): value is { text: string } {
  if (value === null || typeof value !== 'object') {
    return false
  }

  const contentPart = value as CallToolContentPart
  return contentPart.type === 'text' && typeof contentPart.text === 'string'
}

/**
 * Extracts error information from CallToolResult objects.
 *
 * SDK 1.21.0+ converts errors to CallToolResult, losing original stack traces.
 * This extracts the error message from the content array.
 *
 * @param result - CallToolResult object with error
 * @param _contextStack - Optional Error object for stack context (unused, kept for compatibility)
 * @returns ErrorData with extracted message (no stack trace)
 */
function captureCallToolResultError(result: CallToolResult, _contextStack?: Error): ErrorData {
  // Extract message from content array
  const message =
    result.content
      .filter(isTextContentPart)
      .map((contentPart) => contentPart.text)
      .join(' ')
      .trim() || 'Unknown error'

  const errorData: ErrorData = {
    message,
    type: undefined, // Can't determine actual type from CallToolResult
    platform: 'javascript',
    // No stack or frames - SDK stripped the original error information
  }

  return errorData
}

/**
 * Converts non-Error objects to string representation for error messages.
 *
 * In JavaScript, anything can be thrown (not just Error objects):
 *   throw "string error";
 *   throw { code: 404 };
 *   throw null;
 *
 * This function handles these cases by converting them to meaningful strings.
 *
 * @param value - Non-Error value that was thrown
 * @returns String representation of the value
 */
function stringifyNonError(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  if (value === undefined) {
    return 'undefined'
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  // Try to stringify objects with fallback
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
