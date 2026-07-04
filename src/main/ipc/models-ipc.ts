import { ipcMain } from "electron"
import {
  buildModelList,
  exportCodexCatalog,
  getModelFavorites,
  getModelHidden,
  listGlobalModels,
  testModelRoute,
  toggleModelFavorite,
  toggleModelHidden,
  updateModelRoute
} from "../runtime/models-center"

interface ModelsIpcDeps {
  providerMgr: any
}

let registered = false

export function registerModelsIpc(deps: ModelsIpcDeps): void {
  if (registered) return
  registered = true

  const { providerMgr } = deps

  ipcMain.handle("models:list", (_e, providers?: any[]) => Array.isArray(providers) ? buildModelList(providers) : listGlobalModels())
  ipcMain.handle("models:routeSettings:get", () => providerMgr.getModelRouteSettings())
  ipcMain.handle("models:routeSettings:set", (_e, patch: any) => providerMgr.setModelRouteSettings(patch || {}))
  ipcMain.handle("models:updateRoute", (_e, providerId: string, modelId: string, patch: any) => updateModelRoute(providerId, modelId, patch || {}))
  ipcMain.handle("models:test", (_e, input: { providerId: string; modelId: string; upstreamModel?: string }) => testModelRoute(input))
  ipcMain.handle("models:exportCodexCatalog", () => exportCodexCatalog())
  ipcMain.handle("models:toggleFavorite", (_e, providerId: string, modelId: string) => toggleModelFavorite(providerId, modelId))
  ipcMain.handle("models:toggleHidden", (_e, providerId: string, modelId: string) => toggleModelHidden(providerId, modelId))
  ipcMain.handle("models:favorites", () => [...getModelFavorites()])
  ipcMain.handle("models:hidden", () => [...getModelHidden()])
}
