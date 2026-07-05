import { tr } from '../../glass/i18n'
import { ProviderDef } from '../../glass/meta'

export type ThinkingLevelChoice = 'low' | 'medium' | 'high' | 'xhigh'

export interface WorkbenchThinking {
  mode: 'off' | 'auto' | 'enabled'
  level: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  collapseInUI?: boolean
  budgetTokens?: number
}

/**
 * Get selectable model options from enabled providers.
 */
export function selectableModelOptions(providers: ProviderDef[]): Array<{ providerId: string; modelId: string; label: string; searchable: string }> {
  const options: Array<{ providerId: string; modelId: string; label: string; searchable: string }> = []
  for (const provider of providers) {
    if (!provider.enabled || !provider.apiKey || provider.apiKeyLocked || !provider.models?.length) continue
    for (const model of provider.models) {
      if (model.enabled === false) continue
      const label = `${provider.name} / ${model.label || model.id}`
      options.push({
        providerId: provider.id,
        modelId: model.id,
        label,
        searchable: `${provider.id}/${model.id} ${provider.name} ${model.label || ''}`.toLowerCase()
      })
    }
  }
  return options
}

/**
 * Check if a model selection is valid against current providers.
 */
export function isSelectableModel(selection: ModelSelection | null, providers: ProviderDef[]): boolean {
  if (!selection) return false
  return providers.some(provider =>
    provider.id === selection.providerId &&
    provider.enabled &&
    !!provider.apiKey &&
    !provider.apiKeyLocked &&
    provider.models?.some(model => model.id === selection.modelId && model.enabled !== false)
  )
}

/**
 * Resolve a model command from user input.
 */
export function resolveModelCommand(
  args: string,
  options: Array<{ providerId: string; modelId: string; label: string; searchable: string }>
): { selection?: ModelSelection; label?: string; message?: string } {
  if (options.length === 0) return { message: tr('没有可用模型。请先在设置里启用供应商并填写 Key。', 'No available models. Enable a provider and API key in Settings first.') }
  const raw = args.trim().toLowerCase()
  if (!raw) return { message: tr(`可用模型：${options.slice(0, 8).map(item => `${item.providerId}/${item.modelId}`).join('、')}`, `Available models: ${options.slice(0, 8).map(item => `${item.providerId}/${item.modelId}`).join(', ')}`) }
  const [providerPart, modelPart] = raw.includes('/') ? raw.split('/', 2) : ['', raw]
  const matched = options.find(item => {
    if (providerPart) return item.providerId.toLowerCase() === providerPart && item.modelId.toLowerCase() === modelPart
    return item.modelId.toLowerCase() === modelPart || item.searchable.includes(raw)
  })
  if (!matched) return { message: tr(`没有找到模型：${args}`, `Model not found: ${args}`) }
  return { selection: { providerId: matched.providerId, modelId: matched.modelId, source: 'provider' }, label: matched.label }
}

/**
 * Parse reasoning level from command arguments.
 */
export function reasoningFromCommand(args: string, previous: WorkbenchThinking): WorkbenchThinking | null {
  const value = normalizeReasoningChoice(args)
  return value ? { ...previous, mode: 'enabled', level: value, collapseInUI: true } : null
}

/**
 * Get display label for current thinking level.
 */
export function reasoningLabel(thinking: WorkbenchThinking): string {
  return reasoningChoiceLabel(normalizeReasoningChoice(thinking.level) || 'medium')
}

/**
 * Normalize reasoning choice from user input.
 */
export function normalizeReasoningChoice(value: string): ThinkingLevelChoice | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === '低' || normalized === 'low') return 'low'
  if (normalized === '中' || normalized === 'medium' || normalized === 'mid') return 'medium'
  if (normalized === '高' || normalized === 'high') return 'high'
  if (normalized === '超高' || normalized === '极高' || normalized === 'xhigh' || normalized === 'extra' || normalized === 'max') return 'xhigh'
  return null
}

/**
 * Get display label for a reasoning choice.
 */
export function reasoningChoiceLabel(value: ThinkingLevelChoice): string {
  if (value === 'low') return tr('低', 'low')
  if (value === 'medium') return tr('中', 'medium')
  if (value === 'high') return tr('高', 'high')
  return tr('超高', 'extra high')
}
