import type { IWindow, listenerHandler, RecordPlugin } from '@rrweb/types'
import { createLogger } from '../../../utils/logger'
import { patch } from '../rrweb-plugins/patch'

const logger = createLogger('[WebSocket-Recorder]')
export const PLUGIN_NAME = 'posthog/websocket@1'

let initialisedHandler: listenerHandler | null = null

function initWebSocketObserver(
    cb: (...args: unknown[]) => void,
    win: IWindow
    // options: Record<string, any>
): listenerHandler {
    const restorePatch = patch(
        win,
        'WebSocket',
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        (originalWebSocket: typeof WebSocket) => {
            logger.info('Patching WebSocket')
            const wrappedWebSocket = class WrappedWebSocket extends originalWebSocket {
                constructor(url: string | URL, protocols?: string | string[]) {
                    super(url, protocols)

                    this.addEventListener('open', (event) => {
                        logger.info('Connection opened:', event)
                        cb(event)
                    })

                    this.addEventListener('message', (event) => {
                        logger.info('Message received:', event.data)
                        cb(event)
                    })

                    this.addEventListener('error', (event) => {
                        logger.error('Error occurred:', event)
                        cb(event)
                    })

                    this.addEventListener('close', (event) => {
                        logger.info('Connection closed:', event)
                        cb(event)
                    })
                }
            }
            return wrappedWebSocket
        }
    )
    return () => {
        restorePatch()
    }
}

function initWebSocketRecordPlugin(
    callback: (...args: unknown[]) => void,
    win: IWindow // top window or in an iframe
): listenerHandler {
    if (!('WebSocket' in win)) {
        return () => {
            //
        }
    }

    if (initialisedHandler) {
        logger.warn('Websocket recorder observer already initialised, doing nothing')
        return () => {
            // the first caller should already have this handler and will be responsible for teardown
        }
    }

    const cb = (data: any) => {
        // anything here?
        callback(data)
    }

    // only wrap fetch and xhr if headers or body are being recorded
    let webSocketObserver: listenerHandler = () => {}
    webSocketObserver = initWebSocketObserver(cb, win)

    initialisedHandler = () => {
        webSocketObserver()
    }
    return initialisedHandler
}

// TODO how should this be typed?
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export const getRecordWebSocketPlugin: () => RecordPlugin = (options) => {
    return {
        name: PLUGIN_NAME,
        observer: initWebSocketRecordPlugin,
        options: options,
    }
}
