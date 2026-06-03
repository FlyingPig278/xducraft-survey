import { computed, ref } from 'vue'

export type AdminPanelKey = 'surveys' | 'settings' | 'fields' | 'candidates' | 'archive'
export type RouteState =
  | { mode: 'survey'; surveyId: string }
  | { mode: 'admin'; panel: AdminPanelKey; surveyId?: string }
  | { mode: 'not-found' }

const adminPanelKeys: AdminPanelKey[] = ['surveys', 'settings', 'fields', 'candidates', 'archive']

const hash = ref(window.location.hash)
window.addEventListener('hashchange', () => { hash.value = window.location.hash })

const parseHash = (value: string): RouteState => {
  const clean = value.replace(/^#\/?/, '')
  const segments = clean.split('/').filter(Boolean)
  if (segments[0] === 'admin') {
    const panel = adminPanelKeys.includes(segments[1] as AdminPanelKey)
      ? (segments[1] as AdminPanelKey)
      : 'surveys'
    return { mode: 'admin', panel, surveyId: segments[2] }
  }
  if (segments[0] === 's' && segments[1]) return { mode: 'survey', surveyId: segments[1] }
  return { mode: 'not-found' }
}

export const route = computed(() => parseHash(hash.value))
export const isAdminRoute = computed(() => route.value.mode === 'admin')
export const adminPanel = computed(() => route.value.mode === 'admin' ? route.value.panel : 'surveys')

const setHash = (nextHash: string) => {
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash
  }
  hash.value = nextHash
}

export const navigateSurvey = (id: string) => { setHash(`#/s/${id}`) }
export const navigateAdmin = (panel: AdminPanelKey, surveyId?: string) => {
  setHash(surveyId ? `#/admin/${panel}/${surveyId}` : `#/admin/${panel}`)
}
export const publicSurveyUrlFor = (id: string) =>
  `${window.location.origin}${window.location.pathname}#/s/${id}`

export function useRouter() {
  return {
    route,
    isAdminRoute,
    adminPanel,
    navigateSurvey,
    navigateAdmin,
    publicSurveyUrlFor
  }
}
