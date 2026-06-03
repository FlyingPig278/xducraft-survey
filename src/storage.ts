import type {
  AppState,
  AuthUser,
} from './types'

const USER_KEY = 'xducraft-survey-current-user-v1'
const DEVICE_KEY = 'xducraft-survey-device-id-v1'

export const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export const createSeedState = (): AppState => ({
  surveys: [],
  candidates: [],
  votes: [],
  auditLogs: []
})

export const loadUser = (): AuthUser | null => {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null

  try {
    const user = JSON.parse(raw) as AuthUser
    if (user.authProvider !== 'blessing' || !user.sessionToken) {
      localStorage.removeItem(USER_KEY)
      return null
    }
    return user
  } catch {
    return null
  }
}

export const saveUser = (user: AuthUser | null) => {
  if (!user) {
    localStorage.removeItem(USER_KEY)
    return
  }
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export const clearSessionStorage = () => {
  localStorage.removeItem(USER_KEY)
  localStorage.removeItem(DEVICE_KEY)
}

export const getDeviceId = () => {
  let value = localStorage.getItem(DEVICE_KEY)
  if (!value) {
    value = `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    localStorage.setItem(DEVICE_KEY, value)
  }
  return value
}
