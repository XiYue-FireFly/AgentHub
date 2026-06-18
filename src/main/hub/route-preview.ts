import { AgentRegistry } from "./registry"
import { KeywordRouter } from "./router"

export function routePreview(
  text: string,
  registry: AgentRegistry,
  router = new KeywordRouter()
): Array<{ id: string; score: number }> {
  return router.routeScores(text || "", registry.getAll())
}
