// Portions of this file are derived from getsentry/sentry-javascript by Software, Inc. dba Sentry
// Licensed under the MIT License
function makeUncaughtExceptionHandler(captureFn, onFatalFn) {
    let calledFatalError = false;
    return Object.assign((error) => {
        // Attaching a listener to `uncaughtException` will prevent the node process from exiting. We generally do not
        // want to alter this behaviour so we check for other listeners that users may have attached themselves and adjust
        // exit behaviour of the SDK accordingly:
        // - If other listeners are attached, do not exit.
        // - If the only listener attached is ours, exit.
        const userProvidedListenersCount = global.process.listeners('uncaughtException').filter((listener) => {
            // There are 2 listeners we ignore:
            return (
            // as soon as we're using domains this listener is attached by node itself
            listener.name !== 'domainUncaughtExceptionClear' &&
                // the handler we register in this integration
                listener._posthogErrorHandler !== true);
        }).length;
        const processWouldExit = userProvidedListenersCount === 0;
        captureFn(error, {
            mechanism: {
                type: 'onuncaughtexception',
                handled: false,
            },
        });
        if (!calledFatalError && processWouldExit) {
            calledFatalError = true;
            onFatalFn();
        }
    }, { _posthogErrorHandler: true });
}
export function addUncaughtExceptionListener(captureFn, onFatalFn) {
    global.process.on('uncaughtException', makeUncaughtExceptionHandler(captureFn, onFatalFn));
}
export function addUnhandledRejectionListener(captureFn) {
    global.process.on('unhandledRejection', (reason) => {
        captureFn(reason, {
            mechanism: {
                type: 'onunhandledrejection',
                handled: false,
            },
        });
    });
}
//# sourceMappingURL=autocapture.js.map