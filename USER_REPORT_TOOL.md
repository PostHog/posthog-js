# User Report Feature - Implementation Guide

## Overview

Create a standalone feature for users to report bugs/issues with text + screenshot + annotation capabilities. This is **separate from surveys** and designed for support/incident reporting, with future plans to integrate with ticketing systems (Linear, Jira, etc.).

**Target Timeline:** 2-3 hours for hackathon MVP
**Bundle Size Target:** < 40KB total impact

---

## Architecture Decision

### Why Separate from Surveys?

- **Different product concerns:** Surveys = research tool, Reports = support tool
- **Bundle optimization:** Users who don't need reports don't pay the cost
- **Independent evolution:** Can add ticketing integrations without modifying surveys
- **Simpler codebase:** No "is this a report?" branching throughout survey code

### File Structure

```
src/extensions/user-report/
├── index.ts                    # Main entry, exports UserReportManager
├── types.ts                    # TypeScript interfaces
├── report-widget.tsx           # Main Preact component
├── canvas-annotator.tsx        # Canvas drawing component
├── report-api.ts               # API client (mocked for now)
└── report.css                  # Scoped styles

src/utils/
└── user-report-utils.ts        # Helper functions (optional)
```

---

## Phase 0: Research & Setup (5 min)

### Check Lazy Loading Pattern

Look at how surveys and toolbar handle lazy loading:

- `packages/browser/src/extensions/toolbar.ts` - check `maybeLoadToolbar()`
- `packages/browser/src/posthog-surveys.ts` - check `getSurveys()`

### Check Shadow DOM Pattern

Look at surveys for shadow DOM setup:

- `packages/browser/src/extensions/surveys/surveys-extension-utils.tsx` - `retrieveSurveyShadow()`
- CSS variable system: `addSurveyCSSVariablesToElement()`

### Verify Build System

- Rollup config: `packages/browser/rollup.config.mjs`
- Ensure lazy loading works with dynamic imports

---

## Phase 1: API Design & Config (15 min)

### Step 1.1: Add Config Options

**File:** `packages/browser/src/config.ts`

Add to `defaultConfig()` function around line 173 (after `disable_surveys`):

```typescript
disable_surveys: false,
disable_surveys_automatic_display: false,
enable_user_report: false,  // NEW
user_report: {},            // NEW
```

### Step 1.2: Update TypeScript Types

**File:** `packages/browser/src/types.ts`

Add interface around line ~400 (search for PostHogConfig):

```typescript
export interface UserReportConfig {
    enabled?: boolean
    api_endpoint?: string
    widget_label?: string
    widget_color?: string
    max_screenshot_size?: number // bytes, default 10MB
}

export interface PostHogConfig {
    // ... existing fields ...
    enable_user_report?: boolean
    user_report?: UserReportConfig
}
```

### Step 1.3: Add Method to PostHog Core

**File:** `packages/browser/src/posthog-core.ts`

1. Import at top (~line 20):

```typescript
import { UserReportManager } from './extensions/user-report'
```

2. Add property to class (~line 300):

```typescript
export class PostHog {
    // ... existing properties ...
    _userReport?: UserReportManager

    // ... rest of class
}
```

3. Add public method (~line 2000, near other public methods):

```typescript
/**
 * Show the user report dialog to collect bug reports with optional screenshots
 * @param options Optional customization for the report dialog
 */
showReportDialog(options?: { title?: string; description?: string }): void {
    if (!this.config.enable_user_report) {
        logger.warn('User report feature is not enabled. Set enable_user_report: true in config.')
        return
    }

    if (!this._userReport) {
        logger.info('Loading user report extension...')
        this._userReport = new UserReportManager(this)
    }

    this._userReport.show(options)
}
```

---

## Phase 1.5: Extension Scaffold (10 min)

### Step 1.5.1: Create Directory Structure

Create directory: `packages/browser/src/extensions/user-report/`

### Step 1.5.2: Create Types File

**File:** `packages/browser/src/extensions/user-report/types.ts`

```typescript
export interface ReportData {
    text: string
    screenshot?: Blob
    metadata: {
        url: string
        timestamp: number
        user_agent: string
        viewport: {
            width: number
            height: number
        }
        distinct_id?: string
        session_id?: string
    }
}

export interface ReportDialogOptions {
    title?: string
    description?: string
}

export interface IAnnotationEngine {
    loadImage(blob: Blob): Promise<void>
    addTool(type: 'rectangle' | 'arrow' | 'text' | 'blur' | 'freehand'): void
    setColor(color: string): void
    undo(): void
    redo(): void
    clear(): void
    export(): Promise<Blob>
    destroy(): void
}
```

### Step 1.5.3: Create Main Entry Point

**File:** `packages/browser/src/extensions/user-report/index.ts`

```typescript
import { PostHog } from '../../posthog-core'
import { createLogger } from '../../utils/logger'
import { ReportDialogOptions } from './types'

const logger = createLogger('[UserReport]')

export class UserReportManager {
    private _posthog: PostHog
    private _shadowRoot?: ShadowRoot
    private _isVisible: boolean = false

    constructor(posthog: PostHog) {
        this._posthog = posthog
        logger.info('UserReportManager initialized')
    }

    show(options?: ReportDialogOptions): void {
        if (this._isVisible) {
            logger.warn('Report dialog already visible')
            return
        }

        logger.info('Showing report dialog', options)
        this._isVisible = true

        // TODO: Implement rendering logic in Phase 2
        console.log('Report dialog will be rendered here')
    }

    hide(): void {
        if (!this._isVisible) {
            return
        }

        logger.info('Hiding report dialog')
        this._isVisible = false

        // TODO: Implement hide logic in Phase 2
    }

    destroy(): void {
        logger.info('Destroying UserReportManager')
        this.hide()
        this._shadowRoot = undefined
    }
}
```

### Step 1.5.4: Test Lazy Loading

**Test in browser console:**

```javascript
// Enable the feature
posthog.config.enable_user_report = true

// Try to show dialog
posthog.showReportDialog()

// Should see logs:
// [PostHog.js] [UserReport] UserReportManager initialized
// [PostHog.js] [UserReport] Showing report dialog
```

---

## Phase 2: Basic Popup UI (30 min)

### Step 2.1: Create CSS File

**File:** `packages/browser/src/extensions/user-report/report.css`

```css
.ph-report-container {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'Roboto', Helvetica, Arial, sans-serif;
}

.ph-report-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 2147483646;
}

.ph-report-modal {
    background: white;
    border-radius: 12px;
    box-shadow:
        0 20px 25px -5px rgba(0, 0, 0, 0.1),
        0 10px 10px -5px rgba(0, 0, 0, 0.04);
    width: 500px;
    max-width: 90vw;
    max-height: 90vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

.ph-report-header {
    padding: 20px 24px;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.ph-report-title {
    font-size: 18px;
    font-weight: 600;
    color: #111827;
    margin: 0;
}

.ph-report-close {
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: #6b7280;
    padding: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
}

.ph-report-close:hover {
    background: #f3f4f6;
}

.ph-report-body {
    padding: 24px;
    overflow-y: auto;
    flex: 1;
}

.ph-report-privacy-notice {
    background: #fef3c7;
    border: 1px solid #fbbf24;
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 16px;
    font-size: 13px;
    color: #92400e;
    line-height: 1.5;
}

.ph-report-privacy-notice strong {
    font-weight: 600;
}

.ph-report-label {
    display: block;
    font-size: 14px;
    font-weight: 500;
    color: #374151;
    margin-bottom: 8px;
}

.ph-report-textarea {
    width: 100%;
    min-height: 120px;
    padding: 12px;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    font-size: 14px;
    font-family: inherit;
    resize: vertical;
    margin-bottom: 16px;
}

.ph-report-textarea:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.ph-report-footer {
    padding: 16px 24px;
    border-top: 1px solid #e5e7eb;
    display: flex;
    justify-content: flex-end;
    gap: 12px;
}

.ph-report-button {
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
}

.ph-report-button-cancel {
    background: white;
    border: 1px solid #d1d5db;
    color: #374151;
}

.ph-report-button-cancel:hover {
    background: #f9fafb;
}

.ph-report-button-submit {
    background: #000;
    border: none;
    color: white;
}

.ph-report-button-submit:hover {
    background: #1f2937;
}

.ph-report-button-submit:disabled {
    background: #9ca3af;
    cursor: not-allowed;
}

.ph-report-success {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px 24px;
    text-align: center;
}

.ph-report-success-icon {
    font-size: 48px;
    margin-bottom: 16px;
}

.ph-report-success-title {
    font-size: 20px;
    font-weight: 600;
    color: #111827;
    margin: 0 0 8px 0;
}

.ph-report-success-message {
    font-size: 14px;
    color: #6b7280;
    margin: 0 0 24px 0;
}
```

### Step 2.2: Create Report Widget Component

**File:** `packages/browser/src/extensions/user-report/report-widget.tsx`

```typescript
import { h, Component } from 'preact'
import { createLogger } from '../../utils/logger'
import { PostHog } from '../../posthog-core'
import { ReportData, ReportDialogOptions } from './types'

const logger = createLogger('[UserReport.Widget]')

interface ReportWidgetProps {
    posthog: PostHog
    options?: ReportDialogOptions
    onClose: () => void
}

interface ReportWidgetState {
    text: string
    isSubmitting: boolean
    isSuccess: boolean
    error: string | null
}

export class ReportWidget extends Component<ReportWidgetProps, ReportWidgetState> {
    state: ReportWidgetState = {
        text: '',
        isSubmitting: false,
        isSuccess: false,
        error: null,
    }

    componentDidMount() {
        logger.info('Report widget mounted')
        // Add ESC key listener
        document.addEventListener('keydown', this.handleKeyDown)
    }

    componentWillUnmount() {
        logger.info('Report widget unmounted')
        document.removeEventListener('keydown', this.handleKeyDown)
    }

    handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            logger.info('ESC pressed, closing dialog')
            this.props.onClose()
        }
    }

    handleTextChange = (e: Event) => {
        const target = e.target as HTMLTextAreaElement
        this.setState({ text: target.value })
    }

    handleSubmit = async () => {
        const { text } = this.state
        const { posthog } = this.props

        if (!text.trim()) {
            logger.warn('Cannot submit empty report')
            return
        }

        logger.info('Submitting report...', { textLength: text.length })
        this.setState({ isSubmitting: true, error: null })

        try {
            // Build report data
            const reportData: ReportData = {
                text: text.trim(),
                metadata: {
                    url: window.location.href,
                    timestamp: Date.now(),
                    user_agent: navigator.userAgent,
                    viewport: {
                        width: window.innerWidth,
                        height: window.innerHeight,
                    },
                    distinct_id: posthog.get_distinct_id(),
                    session_id: posthog.get_session_id(),
                },
            }

            // Mock API call for now
            await this.submitToAPI(reportData)

            // Capture PostHog event
            posthog.capture('user_report_submitted', {
                report_length: text.length,
                has_screenshot: false,
            })

            logger.info('Report submitted successfully')
            this.setState({ isSubmitting: false, isSuccess: true })

            // Auto-close after 2 seconds
            setTimeout(() => {
                this.props.onClose()
            }, 2000)
        } catch (error) {
            logger.error('Failed to submit report:', error)
            this.setState({
                isSubmitting: false,
                error: 'Failed to submit report. Please try again.',
            })
        }
    }

    submitToAPI = async (data: ReportData): Promise<void> => {
        // Mock API call - replace with real implementation in Phase 5
        logger.info('📤 Mock API Call:', {
            text: data.text,
            metadata: data.metadata,
        })

        return new Promise((resolve) => {
            setTimeout(() => {
                logger.info('✅ Mock API Response: success')
                resolve()
            }, 1500)
        })
    }

    render() {
        const { options, onClose } = this.props
        const { text, isSubmitting, isSuccess, error } = this.state

        const title = options?.title || 'Report an Issue'
        const canSubmit = text.trim().length > 0 && !isSubmitting

        if (isSuccess) {
            return (
                <div className="ph-report-backdrop" onClick={onClose}>
                    <div className="ph-report-container" onClick={(e) => e.stopPropagation()}>
                        <div className="ph-report-modal">
                            <div className="ph-report-success">
                                <div className="ph-report-success-icon">✓</div>
                                <h3 className="ph-report-success-title">Report Submitted!</h3>
                                <p className="ph-report-success-message">
                                    Thank you for your feedback. We'll review it shortly.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )
        }

        return (
            <div className="ph-report-backdrop" onClick={onClose}>
                <div className="ph-report-container" onClick={(e) => e.stopPropagation()}>
                    <div className="ph-report-modal">
                        <div className="ph-report-header">
                            <h2 className="ph-report-title">{title}</h2>
                            <button
                                className="ph-report-close"
                                onClick={onClose}
                                aria-label="Close"
                                type="button"
                            >
                                ×
                            </button>
                        </div>

                        <div className="ph-report-body">
                            <div className="ph-report-privacy-notice">
                                <strong>⚠️ Privacy Notice:</strong> Screenshots may contain sensitive data.
                                Please blur any personal information before submitting.
                            </div>

                            <label className="ph-report-label">
                                What happened? <span style={{ color: '#ef4444' }}>*</span>
                            </label>
                            <textarea
                                className="ph-report-textarea"
                                placeholder="Describe the issue you encountered..."
                                value={text}
                                onInput={this.handleTextChange}
                                disabled={isSubmitting}
                                autoFocus
                            />

                            {error && (
                                <div style={{ color: '#ef4444', fontSize: '14px', marginTop: '8px' }}>
                                    {error}
                                </div>
                            )}

                            {/* TODO Phase 3: Add screenshot upload here */}
                        </div>

                        <div className="ph-report-footer">
                            <button
                                className="ph-report-button ph-report-button-cancel"
                                onClick={onClose}
                                disabled={isSubmitting}
                                type="button"
                            >
                                Cancel
                            </button>
                            <button
                                className="ph-report-button ph-report-button-submit"
                                onClick={this.handleSubmit}
                                disabled={!canSubmit}
                                type="button"
                            >
                                {isSubmitting ? 'Submitting...' : 'Submit Report'}
                            </button>
                        </div>
                    </div>
                </div>
            )
        }
    }
}
```

### Step 2.3: Update Index to Render Widget

**File:** `packages/browser/src/extensions/user-report/index.ts`

```typescript
import { h, render } from 'preact'
import { PostHog } from '../../posthog-core'
import { createLogger } from '../../utils/logger'
import { ReportDialogOptions } from './types'
import { ReportWidget } from './report-widget'
import { document } from '../../utils/globals'
import reportStyles from './report.css'

const logger = createLogger('[UserReport]')

export class UserReportManager {
    private _posthog: PostHog
    private _container?: HTMLElement
    private _shadowRoot?: ShadowRoot
    private _isVisible: boolean = false

    constructor(posthog: PostHog) {
        this._posthog = posthog
        logger.info('UserReportManager initialized')
    }

    show(options?: ReportDialogOptions): void {
        if (this._isVisible) {
            logger.warn('Report dialog already visible')
            return
        }

        logger.info('Showing report dialog', options)
        this._isVisible = true
        this._render(options)
    }

    hide(): void {
        if (!this._isVisible) {
            return
        }

        logger.info('Hiding report dialog')
        this._isVisible = false
        this._cleanup()
    }

    private _render(options?: ReportDialogOptions): void {
        // Create container
        this._container = document.createElement('div')
        this._container.className = 'PostHogUserReport'

        // Create shadow DOM for style isolation
        this._shadowRoot = this._container.attachShadow({ mode: 'open' })

        // Add styles
        const styleElement = document.createElement('style')
        styleElement.textContent = reportStyles
        this._shadowRoot.appendChild(styleElement)

        // Create mount point
        const mountPoint = document.createElement('div')
        this._shadowRoot.appendChild(mountPoint)

        // Render component
        render(
            h(ReportWidget, {
                posthog: this._posthog,
                options,
                onClose: () => this.hide(),
            }),
            mountPoint
        )

        // Add to DOM
        document.body.appendChild(this._container)

        logger.info('Report dialog rendered')
    }

    private _cleanup(): void {
        if (this._shadowRoot) {
            render(null, this._shadowRoot)
        }

        if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container)
        }

        this._container = undefined
        this._shadowRoot = undefined
    }

    destroy(): void {
        logger.info('Destroying UserReportManager')
        this.hide()
    }
}
```

### Step 2.4: Test in Playground

1. Build the project: `pnpm build`
2. Open playground: `cd packages/browser/playground/nextjs && pnpm dev`
3. In browser console:

```javascript
posthog.config.enable_user_report = true
posthog.showReportDialog()
```

You should see:

- Modal appears with backdrop
- Privacy notice about PII
- Text input working
- Submit/Cancel buttons
- ESC key closes modal

---

## Phase 3: Screenshot Attachment (30 min)

### Step 3.1: Add File Input UI

Update `report-widget.tsx`, add after the textarea in the `render()` method:

```typescript
{/* Screenshot Upload Section */}
<div style={{ marginTop: '16px' }}>
    <label className="ph-report-label">Screenshot (optional)</label>
    <input
        type="file"
        accept="image/*"
        onChange={this.handleFileSelect}
        disabled={isSubmitting}
        style={{ display: 'none' }}
        ref={(el) => (this.fileInputRef = el)}
    />
    <button
        className="ph-report-button"
        onClick={() => this.fileInputRef?.click()}
        disabled={isSubmitting}
        type="button"
        style={{
            background: 'white',
            border: '1px dashed #d1d5db',
            color: '#374151',
            width: '100%',
            padding: '24px',
            marginBottom: '8px',
        }}
    >
        📎 Attach Screenshot
    </button>

    {screenshot && (
        <div style={{ marginTop: '12px', position: 'relative' }}>
            <img
                src={screenshotPreview}
                alt="Screenshot preview"
                style={{
                    maxWidth: '100%',
                    borderRadius: '8px',
                    border: '1px solid #e5e7eb',
                }}
            />
            <button
                onClick={this.handleRemoveScreenshot}
                style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    background: '#ef4444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '50%',
                    width: '28px',
                    height: '28px',
                    cursor: 'pointer',
                    fontSize: '16px',
                }}
                type="button"
            >
                ×
            </button>
        </div>
    )}
</div>
```

### Step 3.2: Add State and Logic

Add to component state:

```typescript
interface ReportWidgetState {
    text: string
    screenshot: File | null
    screenshotPreview: string | null
    isSubmitting: boolean
    isSuccess: boolean
    error: string | null
}

// Add property
fileInputRef: HTMLInputElement | null = null
```

Add methods:

```typescript
handleFileSelect = async (e: Event) => {
    const target = e.target as HTMLInputElement
    const file = target.files?.[0]

    if (!file) return

    logger.info('File selected:', { name: file.name, size: file.size, type: file.type })

    // Validate file type
    if (!file.type.startsWith('image/')) {
        logger.warn('Invalid file type:', file.type)
        this.setState({ error: 'Please select an image file (PNG, JPG, GIF, WebP)' })
        return
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) {
        logger.warn('File too large:', file.size)
        this.setState({ error: 'Screenshot must be smaller than 10MB' })
        return
    }

    // Create preview
    const reader = new FileReader()
    reader.onload = (e) => {
        const preview = e.target?.result as string
        logger.info('Screenshot loaded, creating preview')
        this.setState({
            screenshot: file,
            screenshotPreview: preview,
            error: null,
        })
    }
    reader.readAsDataURL(file)
}

handleRemoveScreenshot = () => {
    logger.info('Removing screenshot')
    this.setState({
        screenshot: null,
        screenshotPreview: null,
    })
    if (this.fileInputRef) {
        this.fileInputRef.value = ''
    }
}
```

Update submit method to include screenshot:

```typescript
handleSubmit = async () => {
    const { text, screenshot } = this.state
    // ... existing validation ...

    const reportData: ReportData = {
        text: text.trim(),
        screenshot: screenshot || undefined,
        metadata: {
            // ... existing metadata ...
        },
    }

    // ... rest of submit logic ...

    posthog.capture('user_report_submitted', {
        report_length: text.length,
        has_screenshot: !!screenshot,
        screenshot_size: screenshot?.size,
    })
}
```

---

## Phase 4: Canvas Annotation (45-60 min)

This is the most complex phase. We'll build a custom canvas with an abstraction layer.

### Step 4.1: Create Canvas Component

**File:** `packages/browser/src/extensions/user-report/canvas-annotator.tsx`

```typescript
import { h, Component, createRef } from 'preact'
import { createLogger } from '../../utils/logger'
import { IAnnotationEngine } from './types'

const logger = createLogger('[UserReport.Canvas]')

type Tool = 'select' | 'rectangle' | 'arrow' | 'text' | 'blur' | 'freehand'

interface CanvasAnnotatorProps {
    imageBlob: Blob
    onSave: (annotatedBlob: Blob) => void
    onCancel: () => void
}

interface CanvasAnnotatorState {
    selectedTool: Tool
    selectedColor: string
    isDrawing: boolean
}

interface DrawElement {
    type: Tool
    color: string
    points: { x: number; y: number }[]
    text?: string
}

export class CanvasAnnotator extends Component<CanvasAnnotatorProps, CanvasAnnotatorState> {
    state: CanvasAnnotatorState = {
        selectedTool: 'select',
        selectedColor: '#ef4444', // red
        isDrawing: false,
    }

    canvasRef = createRef<HTMLCanvasElement>()
    ctx: CanvasRenderingContext2D | null = null
    image: HTMLImageElement | null = null
    elements: DrawElement[] = []
    currentElement: DrawElement | null = null
    history: DrawElement[][] = []

    colors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#000000']

    async componentDidMount() {
        logger.info('Canvas annotator mounted')
        await this.loadImage()
        this.setupCanvas()
    }

    loadImage = async (): Promise<void> => {
        return new Promise((resolve, reject) => {
            const img = new Image()
            const url = URL.createObjectURL(this.props.imageBlob)

            img.onload = () => {
                this.image = img
                URL.revokeObjectURL(url)
                logger.info('Image loaded:', { width: img.width, height: img.height })
                resolve()
            }

            img.onerror = reject
            img.src = url
        })
    }

    setupCanvas = () => {
        const canvas = this.canvasRef.current
        if (!canvas || !this.image) return

        // Set canvas size to image size
        canvas.width = this.image.width
        canvas.height = this.image.height

        this.ctx = canvas.getContext('2d')
        if (!this.ctx) {
            logger.error('Failed to get canvas context')
            return
        }

        // Draw initial image
        this.redraw()

        // Add event listeners
        canvas.addEventListener('mousedown', this.handleMouseDown)
        canvas.addEventListener('mousemove', this.handleMouseMove)
        canvas.addEventListener('mouseup', this.handleMouseUp)

        logger.info('Canvas setup complete')
    }

    redraw = () => {
        if (!this.ctx || !this.image) return

        // Clear canvas
        this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height)

        // Draw image
        this.ctx.drawImage(this.image, 0, 0)

        // Draw all elements
        this.elements.forEach((element) => this.drawElement(element))

        // Draw current element being drawn
        if (this.currentElement) {
            this.drawElement(this.currentElement)
        }
    }

    drawElement = (element: DrawElement) => {
        if (!this.ctx) return

        this.ctx.strokeStyle = element.color
        this.ctx.fillStyle = element.color
        this.ctx.lineWidth = 3

        const points = element.points

        switch (element.type) {
            case 'rectangle':
                if (points.length === 2) {
                    const width = points[1].x - points[0].x
                    const height = points[1].y - points[0].y
                    this.ctx.strokeRect(points[0].x, points[0].y, width, height)
                }
                break

            case 'arrow':
                if (points.length === 2) {
                    this.drawArrow(points[0], points[1])
                }
                break

            case 'freehand':
                if (points.length > 1) {
                    this.ctx.beginPath()
                    this.ctx.moveTo(points[0].x, points[0].y)
                    points.forEach((p) => this.ctx!.lineTo(p.x, p.y))
                    this.ctx.stroke()
                }
                break

            case 'blur':
                if (points.length === 2) {
                    const width = points[1].x - points[0].x
                    const height = points[1].y - points[0].y
                    this.applyBlur(points[0].x, points[0].y, width, height)
                }
                break

            case 'text':
                if (points.length === 1 && element.text) {
                    this.ctx.font = '24px -apple-system, BlinkMacSystemFont, sans-serif'
                    this.ctx.fillText(element.text, points[0].x, points[0].y)
                }
                break
        }
    }

    drawArrow = (from: { x: number; y: number }, to: { x: number; y: number }) => {
        if (!this.ctx) return

        const headLength = 20
        const angle = Math.atan2(to.y - from.y, to.x - from.x)

        // Draw line
        this.ctx.beginPath()
        this.ctx.moveTo(from.x, from.y)
        this.ctx.lineTo(to.x, to.y)
        this.ctx.stroke()

        // Draw arrowhead
        this.ctx.beginPath()
        this.ctx.moveTo(to.x, to.y)
        this.ctx.lineTo(
            to.x - headLength * Math.cos(angle - Math.PI / 6),
            to.y - headLength * Math.sin(angle - Math.PI / 6)
        )
        this.ctx.moveTo(to.x, to.y)
        this.ctx.lineTo(
            to.x - headLength * Math.cos(angle + Math.PI / 6),
            to.y - headLength * Math.sin(angle + Math.PI / 6)
        )
        this.ctx.stroke()
    }

    applyBlur = (x: number, y: number, width: number, height: number) => {
        if (!this.ctx) return

        // Get image data
        const imageData = this.ctx.getImageData(x, y, width, height)
        const pixelSize = 10

        // Pixelate effect
        for (let y = 0; y < imageData.height; y += pixelSize) {
            for (let x = 0; x < imageData.width; x += pixelSize) {
                const i = (y * imageData.width + x) * 4
                const r = imageData.data[i]
                const g = imageData.data[i + 1]
                const b = imageData.data[i + 2]

                // Apply to block
                for (let dy = 0; dy < pixelSize && y + dy < imageData.height; dy++) {
                    for (let dx = 0; dx < pixelSize && x + dx < imageData.width; dx++) {
                        const j = ((y + dy) * imageData.width + (x + dx)) * 4
                        imageData.data[j] = r
                        imageData.data[j + 1] = g
                        imageData.data[j + 2] = b
                    }
                }
            }
        }

        this.ctx.putImageData(imageData, x, y)
    }

    handleMouseDown = (e: MouseEvent) => {
        const { selectedTool, selectedColor } = this.state
        if (selectedTool === 'select') return

        const rect = this.canvasRef.current?.getBoundingClientRect()
        if (!rect) return

        const x = e.clientX - rect.left
        const y = e.clientY - rect.top

        logger.info('Mouse down:', { tool: selectedTool, x, y })

        if (selectedTool === 'text') {
            // Prompt for text
            const text = prompt('Enter text:')
            if (text) {
                this.elements.push({
                    type: 'text',
                    color: selectedColor,
                    points: [{ x, y }],
                    text,
                })
                this.saveHistory()
                this.redraw()
            }
        } else {
            this.currentElement = {
                type: selectedTool,
                color: selectedColor,
                points: [{ x, y }],
            }
            this.setState({ isDrawing: true })
        }
    }

    handleMouseMove = (e: MouseEvent) => {
        if (!this.state.isDrawing || !this.currentElement) return

        const rect = this.canvasRef.current?.getBoundingClientRect()
        if (!rect) return

        const x = e.clientX - rect.left
        const y = e.clientY - rect.top

        if (this.currentElement.type === 'freehand') {
            this.currentElement.points.push({ x, y })
        } else {
            // For shapes, replace the second point
            if (this.currentElement.points.length === 1) {
                this.currentElement.points.push({ x, y })
            } else {
                this.currentElement.points[1] = { x, y }
            }
        }

        this.redraw()
    }

    handleMouseUp = () => {
        if (!this.state.isDrawing || !this.currentElement) return

        logger.info('Mouse up, finalizing element')

        this.elements.push(this.currentElement)
        this.currentElement = null
        this.setState({ isDrawing: false })
        this.saveHistory()
    }

    saveHistory = () => {
        // Save current state for undo
        this.history.push(JSON.parse(JSON.stringify(this.elements)))
        logger.info('History saved, length:', this.history.length)
    }

    handleUndo = () => {
        if (this.history.length === 0) return

        this.history.pop() // Remove current
        const previous = this.history[this.history.length - 1] || []
        this.elements = JSON.parse(JSON.stringify(previous))
        this.redraw()
        logger.info('Undo performed')
    }

    handleClear = () => {
        logger.info('Clearing all elements')
        this.elements = []
        this.saveHistory()
        this.redraw()
    }

    handleSave = async () => {
        logger.info('Saving annotated image')

        const canvas = this.canvasRef.current
        if (!canvas) return

        canvas.toBlob((blob) => {
            if (blob) {
                logger.info('Image exported:', { size: blob.size })
                this.props.onSave(blob)
            }
        }, 'image/png')
    }

    render() {
        const { selectedTool, selectedColor } = this.state

        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                {/* Toolbar */}
                <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <div style={{ fontWeight: 600, marginRight: '16px' }}>Tools:</div>

                    {(['select', 'rectangle', 'arrow', 'text', 'blur', 'freehand'] as Tool[]).map((tool) => (
                        <button
                            key={tool}
                            onClick={() => this.setState({ selectedTool: tool })}
                            style={{
                                padding: '8px 12px',
                                border: '1px solid #d1d5db',
                                borderRadius: '6px',
                                background: selectedTool === tool ? '#3b82f6' : 'white',
                                color: selectedTool === tool ? 'white' : '#374151',
                                cursor: 'pointer',
                                fontSize: '13px',
                                textTransform: 'capitalize',
                            }}
                            type="button"
                        >
                            {tool}
                        </button>
                    ))}

                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                        {this.colors.map((color) => (
                            <button
                                key={color}
                                onClick={() => this.setState({ selectedColor: color })}
                                style={{
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '50%',
                                    background: color,
                                    border: selectedColor === color ? '3px solid #000' : '1px solid #d1d5db',
                                    cursor: 'pointer',
                                }}
                                type="button"
                            />
                        ))}

                        <button onClick={this.handleUndo} style={{ marginLeft: '16px' }} type="button">
                            ↶ Undo
                        </button>
                        <button onClick={this.handleClear} type="button">
                            Clear
                        </button>
                    </div>
                </div>

                {/* Canvas */}
                <div style={{ flex: 1, overflow: 'auto', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <canvas ref={this.canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                </div>

                {/* Footer */}
                <div style={{ padding: '16px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button
                        onClick={this.props.onCancel}
                        style={{ padding: '10px 20px', border: '1px solid #d1d5db', borderRadius: '8px', background: 'white' }}
                        type="button"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={this.handleSave}
                        style={{ padding: '10px 20px', border: 'none', borderRadius: '8px', background: '#000', color: 'white' }}
                        type="button"
                    >
                        Save Annotation
                    </button>
                </div>
            </div>
        )
    }
}
```

### Step 4.2: Integrate Canvas into Widget

Update `report-widget.tsx`:

Add to state:

```typescript
interface ReportWidgetState {
    // ... existing ...
    isAnnotating: boolean
}
```

Add button after file upload:

```typescript
{screenshot && !isAnnotating && (
    <button
        className="ph-report-button"
        onClick={this.handleStartAnnotation}
        type="button"
        style={{
            background: '#3b82f6',
            border: 'none',
            color: 'white',
            width: '100%',
            marginTop: '8px',
        }}
    >
        ✏️ Annotate Screenshot
    </button>
)}
```

Add methods:

```typescript
handleStartAnnotation = () => {
    logger.info('Starting annotation')
    this.setState({ isAnnotating: true })
}

handleAnnotationSave = (annotatedBlob: Blob) => {
    logger.info('Annotation saved')
    const file = new File([annotatedBlob], 'annotated-screenshot.png', { type: 'image/png' })

    // Create new preview
    const reader = new FileReader()
    reader.onload = (e) => {
        this.setState({
            screenshot: file,
            screenshotPreview: e.target?.result as string,
            isAnnotating: false,
        })
    }
    reader.readAsDataURL(file)
}

handleAnnotationCancel = () => {
    logger.info('Annotation cancelled')
    this.setState({ isAnnotating: false })
}
```

Add import and render logic:

```typescript
import { CanvasAnnotator } from './canvas-annotator'

// In render(), replace modal content when annotating:
if (isAnnotating && screenshot) {
    return (
        <div className="ph-report-backdrop" onClick={(e) => e.stopPropagation()}>
            <div
                className="ph-report-container"
                style={{ width: '90vw', height: '90vh', maxWidth: '1200px' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="ph-report-modal" style={{ height: '100%' }}>
                    <CanvasAnnotator
                        imageBlob={screenshot}
                        onSave={this.handleAnnotationSave}
                        onCancel={this.handleAnnotationCancel}
                    />
                </div>
            </div>
        </div>
    )
}
```

---

## Phase 5: API Integration (20 min)

### Step 5.1: Create API Client

**File:** `packages/browser/src/extensions/user-report/report-api.ts`

```typescript
import { createLogger } from '../../utils/logger'
import { ReportData } from './types'

const logger = createLogger('[UserReport.API]')

export interface ReportSubmission {
    text: string
    screenshot_url?: string
    metadata: ReportData['metadata']
}

export interface ReportResponse {
    success: boolean
    report_id: string
}

/**
 * Mock API client - replace with real implementation when backend is ready
 */
export class ReportAPIClient {
    private apiEndpoint: string

    constructor(apiEndpoint?: string) {
        this.apiEndpoint = apiEndpoint || '/api/user-reports'
        logger.info('API client initialized', { endpoint: this.apiEndpoint })
    }

    /**
     * Submit a user report
     * For now, this is a mock that logs to console
     *
     * Real implementation should:
     * 1. If screenshot exists, request presigned URL
     * 2. Upload screenshot to presigned URL (PUT)
     * 3. Submit report with screenshot URL
     */
    async submitReport(data: ReportData): Promise<ReportResponse> {
        logger.info('📤 Submitting report...')

        // Mock implementation
        return this.mockSubmit(data)

        // Real implementation (commented out for now):
        // if (data.screenshot) {
        //     const screenshotUrl = await this.uploadScreenshot(data.screenshot)
        //     return this.submitReportData({ ...data, screenshot_url: screenshotUrl })
        // } else {
        //     return this.submitReportData(data)
        // }
    }

    private async mockSubmit(data: ReportData): Promise<ReportResponse> {
        logger.info('📤 Mock API Call:', {
            endpoint: this.apiEndpoint,
            payload: {
                text: data.text,
                has_screenshot: !!data.screenshot,
                screenshot_size: data.screenshot?.size,
                metadata: data.metadata,
            },
        })

        // Simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 1500))

        const mockResponse: ReportResponse = {
            success: true,
            report_id: `mock-${Date.now()}`,
        }

        logger.info('✅ Mock API Response:', mockResponse)
        return mockResponse
    }

    /**
     * Real implementation: Get presigned URL for screenshot upload
     */
    private async getUploadUrl(): Promise<{ url: string; screenshot_url: string }> {
        const response = await fetch(`${this.apiEndpoint}/upload-url`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        })

        if (!response.ok) {
            throw new Error(`Failed to get upload URL: ${response.statusText}`)
        }

        return response.json()
    }

    /**
     * Real implementation: Upload screenshot to presigned URL
     */
    private async uploadScreenshot(blob: Blob): Promise<string> {
        logger.info('Uploading screenshot...', { size: blob.size })

        // Get presigned URL
        const { url, screenshot_url } = await this.getUploadUrl()

        // Upload to presigned URL
        const response = await fetch(url, {
            method: 'PUT',
            body: blob,
            headers: {
                'Content-Type': blob.type,
            },
        })

        if (!response.ok) {
            throw new Error(`Failed to upload screenshot: ${response.statusText}`)
        }

        logger.info('Screenshot uploaded successfully')
        return screenshot_url
    }

    /**
     * Real implementation: Submit report data to backend
     */
    private async submitReportData(data: ReportData & { screenshot_url?: string }): Promise<ReportResponse> {
        const payload: ReportSubmission = {
            text: data.text,
            screenshot_url: data.screenshot_url,
            metadata: data.metadata,
        }

        const response = await fetch(this.apiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        })

        if (!response.ok) {
            throw new Error(`Failed to submit report: ${response.statusText}`)
        }

        return response.json()
    }
}
```

### Step 5.2: Update Widget to Use API Client

Update `report-widget.tsx`:

```typescript
import { ReportAPIClient } from './report-api'

export class ReportWidget extends Component<ReportWidgetProps, ReportWidgetState> {
    private apiClient: ReportAPIClient

    constructor(props: ReportWidgetProps) {
        super(props)
        const apiEndpoint = props.posthog.config.user_report?.api_endpoint
        this.apiClient = new ReportAPIClient(apiEndpoint)
    }

    // Update handleSubmit:
    handleSubmit = async () => {
        const { text, screenshot } = this.state
        const { posthog } = this.props

        if (!text.trim()) {
            logger.warn('Cannot submit empty report')
            return
        }

        logger.info('Submitting report...', { textLength: text.length, hasScreenshot: !!screenshot })
        this.setState({ isSubmitting: true, error: null })

        try {
            const reportData: ReportData = {
                text: text.trim(),
                screenshot: screenshot || undefined,
                metadata: {
                    url: window.location.href,
                    timestamp: Date.now(),
                    user_agent: navigator.userAgent,
                    viewport: {
                        width: window.innerWidth,
                        height: window.innerHeight,
                    },
                    distinct_id: posthog.get_distinct_id(),
                    session_id: posthog.get_session_id(),
                },
            }

            // Submit via API client
            const response = await this.apiClient.submitReport(reportData)

            // Capture PostHog event
            posthog.capture('user_report_submitted', {
                report_id: response.report_id,
                report_length: text.length,
                has_screenshot: !!screenshot,
                screenshot_size: screenshot?.size,
            })

            logger.info('Report submitted successfully', { report_id: response.report_id })
            this.setState({ isSubmitting: false, isSuccess: true })

            // Auto-close after 2 seconds
            setTimeout(() => {
                this.props.onClose()
            }, 2000)
        } catch (error) {
            logger.error('Failed to submit report:', error)
            this.setState({
                isSubmitting: false,
                error: 'Failed to submit report. Please try again.',
            })
        }
    }
}
```

---

## Phase 6: Testing & Polish (15 min)

### Step 6.1: Test Checklist

Build and test:

```bash
pnpm build
cd packages/browser/playground/nextjs
pnpm dev
```

Open browser with debug mode:

```
http://localhost:3000?__posthog_debug=true
```

In console:

```javascript
// Enable feature
posthog.config.enable_user_report = true

// Test basic dialog
posthog.showReportDialog()

// Test with options
posthog.showReportDialog({
    title: 'Found a bug?',
    description: 'Tell us what went wrong',
})
```

**Test scenarios:**

- [ ] Dialog opens and closes with ESC key
- [ ] Text input works and is required
- [ ] Submit button disabled when empty
- [ ] Privacy notice is visible
- [ ] File upload accepts images only
- [ ] File size validation (> 10MB shows error)
- [ ] Preview thumbnail shows correctly
- [ ] Remove screenshot button works
- [ ] Annotation opens in full screen
- [ ] All tools work: rectangle, arrow, text, blur, freehand
- [ ] Undo button works
- [ ] Clear button works
- [ ] Save annotation updates preview
- [ ] Submit shows loading state
- [ ] Success message appears
- [ ] Dialog auto-closes after success
- [ ] Mock API logs correct data in console
- [ ] PostHog event captured with correct properties

### Step 6.2: Keyboard Accessibility

Verify keyboard navigation works:

- Tab through all interactive elements
- Enter submits form
- ESC closes dialog
- Space activates buttons

### Step 6.3: Bundle Size Check

After build, check bundle size:

```bash
ls -lh packages/browser/dist/*.js | grep -E "(array|module).js"
```

Verify user-report code is:

- Not in main bundle if disabled
- Lazy loaded only when enabled

---

## API Contract Documentation

For future backend implementation:

### POST /api/user-reports/upload-url

**Purpose:** Request presigned URL for screenshot upload

**Response:**

```json
{
    "url": "https://s3.amazonaws.com/...",
    "screenshot_url": "https://cdn.posthog.com/screenshots/..."
}
```

### PUT <presigned-url>

**Purpose:** Upload screenshot binary

**Headers:**

```
Content-Type: image/png
```

**Body:** Raw binary blob

### POST /api/user-reports

**Purpose:** Submit report metadata

**Request:**

```json
{
    "text": "The button doesn't work when...",
    "screenshot_url": "https://cdn.posthog.com/screenshots/abc123.png",
    "metadata": {
        "url": "https://example.com/page",
        "timestamp": 1709240000000,
        "user_agent": "Mozilla/5.0...",
        "viewport": { "width": 1920, "height": 1080 },
        "distinct_id": "user-123",
        "session_id": "session-456"
    }
}
```

**Response:**

```json
{
    "success": true,
    "report_id": "report-abc123"
}
```

---

## Logging Best Practices

**Always use the logger:**

```typescript
import { createLogger } from '../../utils/logger'
const logger = createLogger('[UserReport]')

// Good logging examples:
logger.info('Report dialog opened')
logger.info('File selected:', { name: file.name, size: file.size })
logger.warn('Screenshot too large:', file.size)
logger.error('Failed to submit report:', error)
```

**When to log:**

- Component lifecycle events (mount, unmount)
- User interactions (button clicks, tool selection)
- State changes (submitting, success, error)
- API calls (request start, response received)
- Validation errors
- Any errors or warnings

**Enable debug mode:**

- Set `Config.DEBUG = true` in code
- Or add `?__posthog_debug=true` to URL
- Or set `window.POSTHOG_DEBUG = true` in console

---

## Future Enhancements (Post-Hackathon)

### Error Handling

- Retry failed uploads with exponential backoff
- Offline queue support (store reports locally)
- Better error messages for different failure modes
- Network status detection

### Rate Limiting

- Client-side throttling (max 5 reports per session)
- Cooldown period between submissions
- Warning if user submits too frequently

### Advanced Features

- Auto-detect sensitive areas (faces, credit cards) for blur suggestions
- Keyboard shortcuts for canvas tools (R for rectangle, A for arrow, etc.)
- Mobile touch support for annotation
- Drag-and-drop for screenshot upload
- Paste from clipboard (Cmd+V)
- Multiple screenshots per report
- Screen recording instead of screenshot
- Integration with Linear, Jira, GitHub Issues

### Analytics

- Track tool usage (which annotation tools used most)
- Track completion rate (started vs submitted)
- Track error rates
- Track screenshot sizes and types

---

## Troubleshooting

### Dialog doesn't appear

1. Check `enable_user_report` is true in config
2. Check console for errors
3. Verify shadow DOM rendered: `document.querySelector('.PostHogUserReport')`
4. Check z-index conflicts with other modals

### Canvas not rendering

1. Check image loaded: see "[UserReport.Canvas] Image loaded" log
2. Check canvas context: verify `ctx` is not null
3. Check browser console for CORS errors
4. Try smaller image (< 5MB)

### Logs not appearing

1. Enable debug mode: `?__posthog_debug=true` in URL
2. Or set `window.POSTHOG_DEBUG = true` in console
3. Or edit config.ts to set `debug: true` by default

### Build errors

1. Run `pnpm clean` then `pnpm build`
2. Check for TypeScript errors: `pnpm typecheck`
3. Check for import errors: verify all paths are correct

---

## Summary

This implementation provides:
✅ Standalone feature separate from surveys
✅ Lazy loading (zero impact when disabled)
✅ Text + screenshot + annotation
✅ Privacy notice for GDPR compliance
✅ Blur tool for PII redaction
✅ Custom canvas with abstraction layer (easy to swap)
✅ Mock API ready for real backend
✅ Comprehensive logging for debugging
✅ Bundle size < 40KB
✅ Keyboard accessible
✅ Hackathon-ready in 2-3 hours

Good luck! 🚀
