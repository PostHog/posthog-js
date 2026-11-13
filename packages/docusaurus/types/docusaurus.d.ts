declare module '@docusaurus/ExecutionEnvironment' {
    const ExecutionEnvironment: { canUseDOM: boolean }
    export default ExecutionEnvironment
}

interface Window {
    posthog?: { capture(event: string): void }
}
