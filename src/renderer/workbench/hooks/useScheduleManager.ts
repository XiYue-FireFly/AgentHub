import { useCallback, useEffect, useState } from 'react'
import { DispatchPreset } from '../../src/store/workbench-store'
import {
  defaultCustomSchedule,
  defaultSmartFiveRoleSchedule,
  normalizeScheduleForStorage,
  normalizeStoredSchedule,
  normalizeStoredScheduleOverrides
} from '../customSchedule'

const CUSTOM_SCHEDULE_STORE_KEY = 'agenthub.workbench.customSchedule.v1'
const SMART_SCHEDULE_STORE_KEY = 'agenthub.workbench.smartFiveRoleSchedule.v1'
const SCHEDULE_OVERRIDES_STORE_KEY = 'agenthub.workbench.scheduleOverrides.v1'

export function useScheduleManager() {
  const [customSchedule, setCustomScheduleState] = useState<SchedulePreview>(() => defaultCustomSchedule())
  const [smartSchedule, setSmartScheduleState] = useState<SchedulePreview>(() => defaultSmartFiveRoleSchedule())
  const [scheduleOverrides, setScheduleOverridesState] = useState<Partial<Record<DispatchPreset, SchedulePreview>>>({})

  useEffect(() => {
    const load = async () => {
      try {
        const [custom, smart, overrides] = await Promise.all([
          window.electronAPI.store.get(CUSTOM_SCHEDULE_STORE_KEY),
          window.electronAPI.store.get(SMART_SCHEDULE_STORE_KEY),
          window.electronAPI.store.get(SCHEDULE_OVERRIDES_STORE_KEY)
        ])
        const customSchedule = normalizeStoredSchedule(custom, 'custom')
        const smartSchedule = normalizeStoredSchedule(smart, 'firefly-custom')
        if (customSchedule) setCustomScheduleState(customSchedule)
        if (smartSchedule) setSmartScheduleState(smartSchedule)
        if (overrides) setScheduleOverridesState(normalizeStoredScheduleOverrides(overrides as Record<string, SchedulePreview>))
      } catch {
        // Keep defaults if store read fails.
      }
    }
    load()
  }, [])

  const setCustomSchedule = useCallback((schedule: SchedulePreview) => {
    const next = normalizeScheduleForStorage({ ...schedule, preset: 'custom' as DispatchPreset })
    setCustomScheduleState(next)
    window.electronAPI.store.set(CUSTOM_SCHEDULE_STORE_KEY, next).catch(() => {})
  }, [])

  const setSmartSchedule = useCallback((schedule: SchedulePreview) => {
    const next = normalizeScheduleForStorage({ ...schedule, preset: 'firefly-custom' as DispatchPreset })
    setSmartScheduleState(next)
    window.electronAPI.store.set(SMART_SCHEDULE_STORE_KEY, next).catch(() => {})
  }, [])

  const setScheduleForMode = useCallback((preset: DispatchPreset, schedule: SchedulePreview) => {
    if (preset === 'custom') {
      setCustomSchedule(schedule)
      return
    }
    if (preset === 'firefly-custom') {
      setSmartSchedule(schedule)
      return
    }
    const nextSchedule = normalizeScheduleForStorage({ ...schedule, preset })
    const next = { ...scheduleOverrides, [preset]: nextSchedule }
    setScheduleOverridesState(next)
    window.electronAPI.store.set(SCHEDULE_OVERRIDES_STORE_KEY, next).catch(() => {})
  }, [scheduleOverrides, setCustomSchedule, setSmartSchedule])

  const scheduleForMode = useCallback((preset: DispatchPreset): SchedulePreview => {
    if (preset === 'custom') return customSchedule
    if (preset === 'firefly-custom') return smartSchedule
    return scheduleOverrides[preset] || normalizeScheduleForStorage({ ...defaultCustomSchedule(), preset })
  }, [customSchedule, smartSchedule, scheduleOverrides])

  return {
    customSchedule,
    smartSchedule,
    scheduleOverrides,
    setCustomSchedule,
    setSmartSchedule,
    setScheduleForMode,
    scheduleForMode
  }
}
