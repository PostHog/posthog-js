import { addEventListener } from '../../utils'
import { h } from 'preact'
import { useRef, useEffect, useState } from 'preact/hooks'
import { MarkerArea, ArrowMarker, FrameMarker, TextMarker, Renderer } from '@markerjs/markerjs3'
import { createLogger } from '../../utils/logger'
import { document as _document } from '../../utils/globals'

const document = _document as Document

const logger = createLogger('[UserReport.AnnotationOverlay]')

interface AnnotationOverlayProps {
    screenshotDataUrl: string
    onAnnotatedImageReady: (dataUrl: string) => void
}

type MarkerType = 'arrow' | 'box' | 'text'

export const AnnotationOverlay = ({ screenshotDataUrl, onAnnotatedImageReady }: AnnotationOverlayProps) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const editorRef = useRef<MarkerArea | null>(null)
    const [activeMarkerType, setActiveMarkerType] = useState<MarkerType | null>(null)
    const [canUndo, setCanUndo] = useState(false)
    const [canRedo, setCanRedo] = useState(false)
    const [isAnnotating, setIsAnnotating] = useState(true)

    useEffect(() => {
        if (!editorRef.current && containerRef.current && screenshotDataUrl) {
            logger.info('Initializing MarkerArea')

            // Create img element from data URL
            const targetImg = document.createElement('img')
            targetImg.src = screenshotDataUrl

            // Wait for image to load before creating editor
            targetImg.onload = () => {
                if (!containerRef.current || editorRef.current) return

                // Create MarkerArea
                const editor = new MarkerArea()
                editor.targetImage = targetImg

                // Set target width based on container
                const containerWidth = containerRef.current.clientWidth
                editor.targetWidth =
                    containerWidth < 400
                        ? 400
                        : containerWidth < 2000
                          ? Math.round((containerWidth * 0.9) / 10) * 10
                          : -1

                // Listen to marker events - update state immediately
                addEventListener(editor, 'areastatechange', () => {
                    // Force state update by checking current editor state
                    if (editorRef.current) {
                        setCanUndo(editorRef.current.isUndoPossible)
                        setCanRedo(editorRef.current.isRedoPossible)
                    }
                })

                addEventListener(editor, 'markercreate', () => {
                    // Switch back to select mode after creating a marker
                    setActiveMarkerType(null)
                    editor.switchToSelectMode()
                })

                // Append to container
                containerRef.current.appendChild(editor)
                editorRef.current = editor

                logger.info('MarkerArea initialized')
            }
        }
    }, [screenshotDataUrl])

    const createMarker = (type: MarkerType) => {
        if (!editorRef.current) return

        setActiveMarkerType(type)

        switch (type) {
            case 'arrow':
                editorRef.current.createMarker(ArrowMarker)
                break
            case 'box':
                editorRef.current.createMarker(FrameMarker)
                break
            case 'text':
                editorRef.current.createMarker(TextMarker)
                break
        }
    }

    const handleUndo = () => {
        if (editorRef.current) {
            editorRef.current.undo()
            // Immediately update state after undo
            setCanUndo(editorRef.current.isUndoPossible)
            setCanRedo(editorRef.current.isRedoPossible)
        }
    }

    const handleRedo = () => {
        if (editorRef.current) {
            editorRef.current.redo()
            // Immediately update state after redo
            setCanUndo(editorRef.current.isUndoPossible)
            setCanRedo(editorRef.current.isRedoPossible)
        }
    }

    const handleDone = async () => {
        if (!editorRef.current) return

        logger.info('Saving annotated image')

        const currentState = editorRef.current.getState()
        const renderer = new Renderer()
        renderer.targetImage = editorRef.current.targetImage
        renderer.naturalSize = true
        renderer.imageType = 'image/png'

        const renderedImage = await renderer.rasterize(currentState)

        // Hide the annotation editor
        setIsAnnotating(false)

        // Pass the annotated image back to parent
        onAnnotatedImageReady(renderedImage)
    }

    // If not annotating, just show the screenshot
    if (!isAnnotating) {
        return (
            <img
                src={screenshotDataUrl}
                alt="Screenshot"
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                }}
            />
        )
    }

    return (
        <div
            className="ph-annotation-container"
            style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            {/* Toolbar */}
            <div
                className="ph-annotation-toolbar-top"
                style={{
                    display: 'flex',
                    gap: '8px',
                    padding: '12px',
                    background: 'var(--ph-report-surface)',
                    borderBottom: '1px solid var(--ph-report-border)',
                    alignItems: 'center',
                }}
            >
                {/* Marker Tools */}
                <button
                    onClick={() => createMarker('arrow')}
                    className={activeMarkerType === 'arrow' ? 'ph-annotation-btn-active' : 'ph-annotation-btn'}
                    style={{
                        padding: '8px 16px',
                        background:
                            activeMarkerType === 'arrow' ? 'var(--ph-report-accent)' : 'var(--ph-report-surface-hover)',
                        color: activeMarkerType === 'arrow' ? 'white' : 'var(--ph-report-text-primary)',
                        border: '1px solid var(--ph-report-border)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 500,
                        transition: 'all 0.15s ease',
                    }}
                >
                    Arrow
                </button>
                <button
                    onClick={() => createMarker('box')}
                    className={activeMarkerType === 'box' ? 'ph-annotation-btn-active' : 'ph-annotation-btn'}
                    style={{
                        padding: '8px 16px',
                        background:
                            activeMarkerType === 'box' ? 'var(--ph-report-accent)' : 'var(--ph-report-surface-hover)',
                        color: activeMarkerType === 'box' ? 'white' : 'var(--ph-report-text-primary)',
                        border: '1px solid var(--ph-report-border)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 500,
                        transition: 'all 0.15s ease',
                    }}
                >
                    Box
                </button>
                <button
                    onClick={() => createMarker('text')}
                    className={activeMarkerType === 'text' ? 'ph-annotation-btn-active' : 'ph-annotation-btn'}
                    style={{
                        padding: '8px 16px',
                        background:
                            activeMarkerType === 'text' ? 'var(--ph-report-accent)' : 'var(--ph-report-surface-hover)',
                        color: activeMarkerType === 'text' ? 'white' : 'var(--ph-report-text-primary)',
                        border: '1px solid var(--ph-report-border)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 500,
                        transition: 'all 0.15s ease',
                    }}
                >
                    Text
                </button>

                {/* Divider */}
                <div style={{ width: '1px', height: '24px', background: 'var(--ph-report-border)' }} />

                {/* Undo/Redo */}
                <button
                    onClick={handleUndo}
                    disabled={!canUndo}
                    className="ph-annotation-btn"
                    style={{
                        padding: '8px 16px',
                        background: 'var(--ph-report-surface-hover)',
                        color: canUndo ? 'var(--ph-report-text-primary)' : 'var(--ph-report-text-muted)',
                        border: '1px solid var(--ph-report-border)',
                        borderRadius: '6px',
                        cursor: canUndo ? 'pointer' : 'not-allowed',
                        fontWeight: 500,
                        opacity: canUndo ? 1 : 0.5,
                        transition: 'all 0.15s ease',
                    }}
                >
                    Undo
                </button>
                <button
                    onClick={handleRedo}
                    disabled={!canRedo}
                    className="ph-annotation-btn"
                    style={{
                        padding: '8px 16px',
                        background: 'var(--ph-report-surface-hover)',
                        color: canRedo ? 'var(--ph-report-text-primary)' : 'var(--ph-report-text-muted)',
                        border: '1px solid var(--ph-report-border)',
                        borderRadius: '6px',
                        cursor: canRedo ? 'pointer' : 'not-allowed',
                        fontWeight: 500,
                        opacity: canRedo ? 1 : 0.5,
                        transition: 'all 0.15s ease',
                    }}
                >
                    Redo
                </button>

                {/* Spacer */}
                <div style={{ flex: 1 }} />

                {/* Done button */}
                <button
                    onClick={handleDone}
                    className="ph-annotation-btn-done"
                    style={{
                        padding: '8px 24px',
                        background: 'var(--ph-report-accent)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        transition: 'all 0.15s ease',
                    }}
                >
                    Done
                </button>
            </div>

            {/* Editor Container - uses flex-grow to fill available space */}
            <div
                ref={containerRef}
                style={{
                    flex: '1 1 auto',
                    position: 'relative',
                    background: 'var(--ph-report-surface)',
                    overflow: 'hidden',
                    minHeight: 0,
                }}
            />
        </div>
    )
}
