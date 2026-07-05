import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  IpcPayloadValidationError,
  validateIpcArgs,
  type IpcArgs,
  type IpcChannel,
  type IpcResult
} from '../../shared/ipc-contract'

export function typedHandle<K extends IpcChannel>(
  channel: K,
  handler: (event: IpcMainInvokeEvent, ...args: IpcArgs<K>) => IpcResult<K> | Promise<IpcResult<K>>
): void {
  ipcMain.handle(channel, ((event: IpcMainInvokeEvent, ...args: unknown[]) => {
    const validation = validateIpcArgs(channel, args)
    if (validation) {
      if (validation.respond) return validation.response as IpcResult<K>
      throw new IpcPayloadValidationError(channel, validation.error)
    }
    return handler(event, ...(args as IpcArgs<K>))
  }) as any)
}
