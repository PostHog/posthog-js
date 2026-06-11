if (!window.__posthogObservedViolations) {
    window.__posthogObservedViolations = []
}

if (window.ReportingObserver) {
    const observer = new window.ReportingObserver(
        (reports) => {
            reports.forEach((violation) => {
                console.log(violation)
                window.__posthogObservedViolations.push(violation)
            })
        },
        {
            types: ['csp-violation'],
        }
    )
    observer.observe()
}
