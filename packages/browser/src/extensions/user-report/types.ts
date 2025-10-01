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
