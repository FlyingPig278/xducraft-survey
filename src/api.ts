import type { AppState, AuthUser, CandidateStatus, FieldDefinition, ResultVisibility, SurveyStatus, UserRole, VoteMode } from './types'
import { getDeviceId, loadUser } from './storage'

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

interface BlessingAuthStatus {
  enabled: boolean
  callbackUrl: string
}

interface AuthSession {
  user: AuthUser
  sessionToken: string
}

interface CreateSurveyPayload {
  title: string
  description: string
  guideText: string
  startsAt?: string | null
  endsAt?: string | null
  voteMode: VoteMode
  maxVotes: number
  resultVisibility: ResultVisibility
  allowVoteEdits: boolean
  requireLogin: boolean
  candidateSubmission: {
    enabled: boolean
    requiresReview: boolean
  }
  candidateFields: FieldDefinition[]
}

interface UpdateSurveyPayload {
  title?: string
  description?: string
  guideText?: string
  status?: SurveyStatus
  startsAt?: string | null
  endsAt?: string | null
  voteMode?: VoteMode
  maxVotes?: number
  resultVisibility?: ResultVisibility
  allowVoteEdits?: boolean
  requireLogin?: boolean
  candidateSubmission?: {
    enabled: boolean
    requiresReview: boolean
  }
}

interface CreateSurveyResult {
  state: AppState
  surveyId: string
}

interface CandidateSubmitResult {
  state: AppState
  candidateStatus: CandidateStatus
}

const apiUrl = (path: string) => `${apiBase}${path}`
const authHeaders = () => {
  const user = loadUser()
  return {
    ...(user?.sessionToken ? { Authorization: `Bearer ${user.sessionToken}` } : {}),
    'X-Device-Id': getDeviceId()
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 15000)
  const abortFromCaller = () => controller.abort(init?.signal?.reason)
  init?.signal?.addEventListener('abort', abortFromCaller, { once: true })
  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...init?.headers
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      let message = errorText || `API 请求失败：${response.status}`
      try {
        const body = JSON.parse(errorText) as { error?: string }
        message = body.error || message
      } catch {
        // Plain text error body.
      }
      throw new Error(message)
    }

    return response.json() as Promise<T>
  } catch (error) {
    if (controller.signal.aborted && !init?.signal?.aborted) throw new Error('API 请求超时，请稍后重试。')
    throw error
  } finally {
    window.clearTimeout(timeout)
    init?.signal?.removeEventListener('abort', abortFromCaller)
  }
}

export const surveyApi = {
  getState: () => request<AppState>('/api/state'),
  submitVote: (payload: { surveyId: string; candidateIds: string[]; guestGameId?: string }) =>
    request<AppState>('/api/votes', { method: 'POST', body: JSON.stringify(payload) }),
  submitCandidate: (payload: { surveyId: string; fields: Record<string, string>; guestGameId?: string }) =>
    request<CandidateSubmitResult>('/api/candidates', { method: 'POST', body: JSON.stringify(payload) }),
  createSurvey: (payload: CreateSurveyPayload) =>
    request<CreateSurveyResult>('/api/admin/surveys', { method: 'POST', body: JSON.stringify(payload) }),
  updateSurvey: (surveyId: string, payload: UpdateSurveyPayload) =>
    request<AppState>(`/api/admin/surveys/${encodeURIComponent(surveyId)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteSurvey: (surveyId: string) =>
    request<AppState>(`/api/admin/surveys/${encodeURIComponent(surveyId)}`, { method: 'DELETE' }),
  updateSurveyFields: (surveyId: string, candidateFields: FieldDefinition[]) =>
    request<AppState>(`/api/admin/surveys/${encodeURIComponent(surveyId)}/fields`, { method: 'PUT', body: JSON.stringify({ candidateFields }) }),
  createAdminCandidate: (payload: { surveyId: string; fields: Record<string, string> }) =>
    request<AppState>('/api/admin/candidates', { method: 'POST', body: JSON.stringify(payload) }),
  updateAdminCandidate: (candidateId: string, payload: { fields?: Record<string, string>; status?: CandidateStatus; reviewNote?: string }) =>
    request<AppState>(`/api/admin/candidates/${encodeURIComponent(candidateId)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteAdminCandidate: (candidateId: string) =>
    request<AppState>(`/api/admin/candidates/${encodeURIComponent(candidateId)}`, { method: 'DELETE' }),
  reorderAdminCandidates: (payload: { surveyId: string; candidateIds: string[] }) =>
    request<AppState>('/api/admin/candidates/reorder', { method: 'POST', body: JSON.stringify(payload) }),
  blessingAuthStatus: () => request<BlessingAuthStatus>('/api/auth/blessing/status'),
  blessingLoginUrl: (returnTo: string, role: UserRole = 'player') => {
    const params = new URLSearchParams({ returnTo, role })
    return apiUrl(`/api/auth/blessing/login?${params.toString()}`)
  },
  consumeBlessingTicket: (ticket: string) =>
    request<AuthSession>(`/api/auth/blessing/session?${new URLSearchParams({ ticket }).toString()}`)
}
