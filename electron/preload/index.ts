import { contextBridge, ipcRenderer } from 'electron'

const INVOKE_CHANNELS = [
  'get-app-info',
  'select-directory',
  'library:get',
  'library:job',
  'library:running',
  'library:logs',
  'library:logs-clear',
  'library:scan',
  'library:import',
  'library:remove',
  'library:rescan',
  'library:start-asr',
  'library:start-analyze',
  'library:start-synthesis',
  'library:start-global',
  'library:global-script',
  'library:stop-analyze',
  'library:cand-update',
  'library:hl-delete',
  'library:hl-reslice',
  'mix:arrange',
  'mix:render',
  'mix:render-state',
  'mix:open-output',
  'settings:get',
  'settings:save'
] as const

const api = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
    if ((INVOKE_CHANNELS as readonly string[]).includes(channel)) {
      return ipcRenderer.invoke(channel, ...args)
    }
    return Promise.reject(new Error(`Invalid channel: ${channel}`))
  },
  onLibraryUpdate: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('library-updated', listener)
    return () => {
      ipcRenderer.removeListener('library-updated', listener)
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api