import { contextBridge, ipcRenderer } from 'electron'
import { BRIDGE_KEY, COMMAND_CHANNEL, STATE_CHANNEL, type Bridge, type State } from '../shared/protocol'

export function exposePostHogBridge(): void {
    const bridge: Bridge = {
        request: (request) => ipcRenderer.invoke(COMMAND_CHANNEL, request),
        subscribe: (callback) => {
            const listener = (_event: Electron.IpcRendererEvent, state: State): void => callback(state)
            ipcRenderer.on(STATE_CHANNEL, listener)
            return () => ipcRenderer.removeListener(STATE_CHANNEL, listener)
        },
    }
    contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge)
}
