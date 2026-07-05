import { ipcRenderer } from 'electron'
import type { IpcArgs, IpcChannel, IpcResult } from '../shared/ipc-contract'

export function typedInvoke<K extends IpcChannel>(
  channel: K,
  ...args: IpcArgs<K>
): Promise<IpcResult<K>> {
  return ipcRenderer.invoke(channel, ...args)
}
