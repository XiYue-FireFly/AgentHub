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
import { typedHandle } from "./typed-ipc"

interface ModelsIpcDeps {
  providerMgr: any
}

let registered = false

export function registerModelsIpc(deps: ModelsIpcDeps): void {
  if (registered) return
  registered = true

  const { providerMgr } = deps

  typedHandle("models:list", (_e, providers) => Array.isArray(providers) ? buildModelList(providers) : listGlobalModels())
  typedHandle("models:routeSettings:get", () => providerMgr.getModelRouteSettings())
  typedHandle("models:routeSettings:set", (_e, patch) => providerMgr.setModelRouteSettings(patch || {}))
  typedHandle("models:updateRoute", (_e, providerId, modelId, patch) => updateModelRoute(providerId, modelId, patch || {}))
  typedHandle("models:test", (_e, input) => testModelRoute(input))
  typedHandle("models:exportCodexCatalog", () => exportCodexCatalog())
  typedHandle("models:toggleFavorite", (_e, providerId, modelId) => toggleModelFavorite(providerId, modelId))
  typedHandle("models:toggleHidden", (_e, providerId, modelId) => toggleModelHidden(providerId, modelId))
  typedHandle("models:favorites", () => [...getModelFavorites()])
  typedHandle("models:hidden", () => [...getModelHidden()])
}
