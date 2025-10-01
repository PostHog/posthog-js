import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { createLogger } from '../../utils/logger'
import { window as _window, document as _document } from '../../utils/globals'
import { domToCanvas } from 'modern-screenshot'
import { addEventListener } from '../../utils'

const logger = createLogger('[UserReport.ScreenshotCapture]')

const window = _window as Window & typeof globalThis
const document = _document as Document

interface ScreenshotCaptureProps {
    onCapture: (dataUrl: string) => void
    onCancel: () => void
}

interface SelectionRect {
    startX: number
    startY: number
    endX: number
    endY: number
}

export const ScreenshotCapture = ({ onCapture, onCancel }: ScreenshotCaptureProps) => {
    const [isSelecting, setIsSelecting] = useState(false)
    const [selection, setSelection] = useState<SelectionRect | null>(null)
    const [isCapturing, setIsCapturing] = useState(false)

    useEffect(() => {
        logger.info('Screenshot capture overlay mounted')

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                logger.info('ESC pressed, canceling capture')
                onCancel()
            }
        }

        addEventListener(window, 'keydown', handleKeyDown as EventListener)

        return () => {
            window?.removeEventListener('keydown', handleKeyDown)
        }
    }, [onCancel])

    const handleMouseDown = (e: MouseEvent) => {
        logger.info('Starting selection', { x: e.clientX, y: e.clientY })
        setIsSelecting(true)
        setSelection({
            startX: e.clientX,
            startY: e.clientY,
            endX: e.clientX,
            endY: e.clientY,
        })
    }

    const handleMouseMove = (e: MouseEvent) => {
        if (!isSelecting || !selection) return

        setSelection({
            ...selection,
            endX: e.clientX,
            endY: e.clientY,
        })
    }

    const handleMouseUp = async (e: MouseEvent) => {
        if (!isSelecting || !selection) return

        logger.info('Selection complete', selection)
        setIsSelecting(false)

        // Calculate final selection bounds
        Math.min(selection.startX, e.clientX)
        Math.min(selection.startY, e.clientY)
        const width = Math.abs(e.clientX - selection.startX)
        const height = Math.abs(e.clientY - selection.startY)

        // Minimum size check
        if (width < 10 || height < 10) {
            logger.warn('Selection too small, canceling')
            setSelection(null)
            return
        }

        // Hide overlay, capture page, then callback
        setIsCapturing(true)

        // Small delay to let overlay hide
        setTimeout(async () => {
            try {
                const dataUrl = await captureFullPage()
                logger.info('Screenshot captured successfully')
                onCapture(dataUrl.toDataURL('image/png'))
            } catch (error) {
                logger.error('Failed to capture screenshot', error)
                onCancel()
            }
        }, 100)
    }

    // Calculate selection box dimensions for rendering
    const getSelectionStyle = () => {
        if (!selection) return {}

        const x = Math.min(selection.startX, selection.endX)
        const y = Math.min(selection.startY, selection.endY)
        const width = Math.abs(selection.endX - selection.startX)
        const height = Math.abs(selection.endY - selection.startY)

        return {
            left: `${x}px`,
            top: `${y}px`,
            width: `${width}px`,
            height: `${height}px`,
        }
    }

    // Hide overlay when capturing
    if (isCapturing) {
        return null
    }

    return (
        <div
            className="ph-screenshot-overlay"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
        >
            {/* Instructions */}
            <div className="ph-screenshot-instructions">
                <p>Click and drag to select an area</p>
                <p className="ph-screenshot-instructions-sub">Press ESC to cancel</p>
            </div>

            {/* Selection box */}
            {selection && (
                <div className="ph-screenshot-selection" style={getSelectionStyle()}>
                    <div className="ph-screenshot-selection-border" />
                </div>
            )}
        </div>
    )
}

/**
 * Captures the full page using modern-screenshot
 * Note: Currently bundled directly (~20KB). TODO: Lazy load via entrypoint
 */
async function captureFullPage(): Promise<HTMLCanvasElement> {
    if (!document || !window) {
        throw new Error('Document/window not available')
    }

    const documentElement = document.documentElement

    try {
        logger.info('Capturing page with modern-screenshot')

        // Capture the entire document
        const canvas = await domToCanvas(documentElement, {
            scale: window.devicePixelRatio || 1,
            backgroundColor: '#ffffff',
        })

        logger.info('Page captured successfully')
        return canvas
    } catch (error) {
        // Fallback: create a placeholder canvas
        logger.warn('Screenshot capture failed, using placeholder', error)
        const width = documentElement.clientWidth
        const height = documentElement.clientHeight
        return createPlaceholderCanvas(width, height)
    }
}

/**
 * Creates a placeholder canvas when actual capture fails
 * Used as fallback when modern-screenshot encounters issues
 */
function createPlaceholderCanvas(width: number, height: number): HTMLCanvasElement {
    if (!document || !window) {
        throw new Error('Document/window not available')
    }

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    if (!ctx) {
        throw new Error('Could not get canvas context')
    }

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    // Create a subtle gradient background
    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, '#f3f4f6')
    gradient.addColorStop(1, '#e5e7eb')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    // Add grid pattern
    ctx.strokeStyle = '#d1d5db'
    ctx.lineWidth = 1
    const gridSize = 40
    for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
    }
    for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
    }

    // Add text overlay
    ctx.fillStyle = '#9ca3af'
    ctx.font = '14px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Screenshot placeholder', width / 2, height / 2 - 10)
    ctx.font = '12px system-ui, -apple-system, sans-serif'
    ctx.fillText(`(${width}×${height} - CORS prevented actual capture)`, width / 2, height / 2 + 10)

    return canvas
}
