import { computed, ref, watch } from 'vue'
import type { AppState, SurveyDefinition } from '../types'
import { createId, createSeedState } from '../storage'
import { surveyApi } from '../api'
import { createDiscreteApi } from 'naive-ui'
import { route, navigateAdmin } from './useRouter'

const { message } = createDiscreteApi(['message'])

const appState = ref<AppState>(createSeedState())
const apiLoading = ref(true)
const apiError = ref('')
const stateRevision = ref(0)
const adminSurveyId = ref(appState.value.surveys[0]?.id ?? '')

const activeSurveyId = computed(() =>
  route.value.mode === 'survey' ? route.value.surveyId : adminSurveyId.value
)
const survey = computed<SurveyDefinition>(() => {
  const found = appState.value.surveys.find((item) => item.id === activeSurveyId.value)
  return found ?? appState.value.surveys[0]!
})

// Keep adminSurveyId valid and in sync with the route.
watch(() => appState.value.surveys.map((s) => s.id).join('|'), () => {
  if (!appState.value.surveys.some((s) => s.id === adminSurveyId.value)) {
    adminSurveyId.value = appState.value.surveys[0]?.id ?? ''
  }
}, { immediate: true })

watch(route, (nextRoute) => {
  if (nextRoute.mode !== 'admin') return
  if (nextRoute.surveyId && appState.value.surveys.some((item) => item.id === nextRoute.surveyId)) {
    adminSurveyId.value = nextRoute.surveyId
    return
  }
  if (adminSurveyId.value && nextRoute.surveyId !== adminSurveyId.value) {
    navigateAdmin(nextRoute.panel, adminSurveyId.value)
  }
}, { immediate: true })

watch(adminSurveyId, (surveyId) => {
  if (route.value.mode === 'admin' && surveyId && route.value.surveyId !== surveyId) {
    navigateAdmin(route.value.panel, surveyId)
  }
})

export function useAppState() {
  const surveys = computed(() => [...appState.value.surveys].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
  const surveyById = (id: string) => appState.value.surveys.find((item) => item.id === id)
  const surveyTitleById = (id: string) => surveyById(id)?.title ?? '未知问卷'

  const applyRemoteState = (state: AppState, preferredSurveyId = adminSurveyId.value) => {
    appState.value = state
    if (preferredSurveyId && state.surveys.some((item) => item.id === preferredSurveyId)) {
      adminSurveyId.value = preferredSurveyId
    } else {
      adminSurveyId.value = state.surveys[0]?.id ?? ''
    }
  }

  const loadAppState = async () => {
    apiLoading.value = true
    apiError.value = ''
    const revisionAtStart = stateRevision.value
    try {
      const nextState = await surveyApi.getState()
      if (revisionAtStart === stateRevision.value) {
        applyRemoteState(nextState, route.value.mode === 'admin' ? route.value.surveyId : adminSurveyId.value)
      }
      return nextState
    } catch (error) {
      apiError.value = error instanceof Error ? error.message : '无法连接 API 服务'
      message.error('无法连接 API 服务，请确认后端已启动。')
      return null
    } finally {
      apiLoading.value = false
    }
  }

  const persist = async (preferredSurveyId = activeSurveyId.value): Promise<boolean> => {
    apiError.value = ''
    stateRevision.value += 1
    try {
      applyRemoteState(await surveyApi.saveState(appState.value), preferredSurveyId)
      return true
    } catch (error) {
      apiError.value = error instanceof Error ? error.message : '保存失败'
      message.error('保存失败，请检查 API 服务。')
      return false
    }
  }

  const addAudit = (action: string, detail: string, surveyId = activeSurveyId.value, actor = 'System') => {
    appState.value.auditLogs.unshift({ id: createId('log'), action, actor, detail, surveyId, createdAt: new Date().toISOString() })
  }

  const resetDemo = async () => {
    try {
      stateRevision.value += 1
      applyRemoteState(await surveyApi.resetState(), '')
      message.success('演示数据已重置')
      return true
    } catch {
      message.error('重置失败，请确认 API 服务已启动。')
      return false
    }
  }

  return {
    appState,
    apiLoading,
    apiError,
    adminSurveyId,
    activeSurveyId,
    survey,
    surveys,
    surveyById,
    surveyTitleById,
    applyRemoteState,
    loadAppState,
    persist,
    addAudit,
    resetDemo,
    message
  }
}
