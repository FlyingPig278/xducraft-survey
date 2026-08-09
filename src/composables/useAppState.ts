import { computed, ref, watch } from 'vue'
import type { AppState, SurveyDefinition } from '../types'
import { createSeedState } from '../storage'
import { surveyApi } from '../api'
import { createDiscreteApi } from 'naive-ui'
import { route, navigateAdmin } from './useRouter'

const { message } = createDiscreteApi(['message'])

const appState = ref<AppState>(createSeedState())
const emptySurvey: SurveyDefinition = {
  id: '',
  title: '',
  description: '',
  guideText: '',
  status: 'draft',
  startsAt: null,
  endsAt: null,
  resultVisibility: 'always',
  allowVoteEdits: false,
  requireLogin: true,
  voteMode: 'multiple',
  maxVotes: 3,
  candidateSubmission: {
    enabled: true,
    requiresReview: true
  },
  candidateFields: [],
  createdAt: '',
  updatedAt: ''
}
const apiLoading = ref(true)
const apiError = ref('')
const stateRevision = ref(0)
const adminSurveyId = ref(appState.value.surveys[0]?.id ?? '')
const REMOTE_SYNC_INTERVAL_MS = 3000
let remoteSyncTimer: number | undefined
let remoteSyncInFlight = false

interface LoadAppStateOptions {
  silent?: boolean
  preferredSurveyId?: string
}

const activeSurveyId = computed(() =>
  route.value.mode === 'survey' ? route.value.surveyId : adminSurveyId.value
)
const survey = computed<SurveyDefinition>(() => {
  const found = appState.value.surveys.find((item) => item.id === activeSurveyId.value)
  return found ?? appState.value.surveys[0] ?? emptySurvey
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
    stateRevision.value += 1
    appState.value = { ...state, results: state.results ?? {} }
    if (preferredSurveyId && state.surveys.some((item) => item.id === preferredSurveyId)) {
      adminSurveyId.value = preferredSurveyId
    } else {
      adminSurveyId.value = state.surveys[0]?.id ?? ''
    }
  }

  const loadAppState = async (options: LoadAppStateOptions = {}) => {
    if (remoteSyncInFlight) return null
    remoteSyncInFlight = true
    const silent = options.silent ?? false
    if (!silent) apiLoading.value = true
    apiError.value = ''
    const revisionAtStart = stateRevision.value
    try {
      const nextState = await surveyApi.getState()
      if (revisionAtStart === stateRevision.value) {
        applyRemoteState(nextState, options.preferredSurveyId ?? (route.value.mode === 'admin' ? route.value.surveyId : adminSurveyId.value))
      }
      return nextState
    } catch (error) {
      apiError.value = error instanceof Error ? error.message : '无法连接 API 服务'
      if (!silent) message.error('无法连接 API 服务，请确认后端已启动。')
      return null
    } finally {
      remoteSyncInFlight = false
      if (!silent) apiLoading.value = false
    }
  }

  const syncRemoteState = () => {
    void loadAppState({ silent: true })
  }

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') syncRemoteState()
  }

  const startRemoteSync = () => {
    if (typeof window === 'undefined') return
    stopRemoteSync()
    remoteSyncTimer = window.setInterval(syncRemoteState, REMOTE_SYNC_INTERVAL_MS)
    window.addEventListener('focus', syncRemoteState)
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }

  const stopRemoteSync = () => {
    if (typeof window === 'undefined') return
    if (remoteSyncTimer !== undefined) {
      window.clearInterval(remoteSyncTimer)
      remoteSyncTimer = undefined
    }
    window.removeEventListener('focus', syncRemoteState)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
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
    startRemoteSync,
    stopRemoteSync,
    message
  }
}
