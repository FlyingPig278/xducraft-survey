import type { AppState, AuthUser, UserRole } from './types'

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

interface BlessingAuthStatus {
  enabled: boolean
  callbackUrl: string
}

const apiUrl = (path: string) => `${apiBase}${path}`

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers
    }
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `API 请求失败：${response.status}`)
  }

  return response.json() as Promise<T>
}

export const surveyApi = {
  getState: () => request<AppState>('/api/state'),
  saveState: (state: AppState) =>
    request<AppState>('/api/state', {
      method: 'PUT',
      body: JSON.stringify(state)
    }),
  blessingAuthStatus: () => request<BlessingAuthStatus>('/api/auth/blessing/status'),
  blessingLoginUrl: (returnTo: string, role: UserRole = 'player') => {
    const params = new URLSearchParams({ returnTo, role })
    return apiUrl(`/api/auth/blessing/login?${params.toString()}`)
  },
  consumeBlessingTicket: (ticket: string) =>
    request<AuthUser>(`/api/auth/blessing/session?${new URLSearchParams({ ticket }).toString()}`)
}
