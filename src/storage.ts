import type {
  AppState,
  AuthUser,
} from './types'

const USER_KEY = 'xducraft-survey-current-user-v1'
const DEVICE_KEY = 'xducraft-survey-device-id-v1'
const memoryStorage = new Map<string, string>()

const storageGet = (key: string) => {
  try {
    return localStorage.getItem(key) ?? memoryStorage.get(key) ?? null
  } catch {
    return memoryStorage.get(key) ?? null
  }
}

const storageSet = (key: string, value: string) => {
  memoryStorage.set(key, value)
  try {
    localStorage.setItem(key, value)
  } catch {
    // In-memory fallback keeps the current tab usable when storage is unavailable.
  }
}

const storageRemove = (key: string) => {
  memoryStorage.delete(key)
  try {
    localStorage.removeItem(key)
  } catch {
    // Ignore unavailable browser storage.
  }
}

export const createId = (prefix: string) => `${prefix}-${
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}`

export const createSeedState = (): AppState => ({
  surveys: [],
  candidates: [],
  votes: [],
  auditLogs: [],
  results: {}
})

export const loadUser = (): AuthUser | null => {
  const raw = storageGet(USER_KEY)
  if (!raw) return null

  try {
    const user = JSON.parse(raw) as AuthUser
    if (user.authProvider !== 'blessing' || !user.sessionToken) {
      storageRemove(USER_KEY)
      return null
    }
    return user
  } catch {
    storageRemove(USER_KEY)
    return null
  }
}

export const saveUser = (user: AuthUser | null) => {
  if (!user) {
    storageRemove(USER_KEY)
    return
  }
  storageSet(USER_KEY, JSON.stringify(user))
}

export const clearSessionStorage = () => {
  storageRemove(USER_KEY)
}

export const getDeviceId = () => {
  let value = storageGet(DEVICE_KEY)
  if (!value) {
    value = createId('device')
    storageSet(DEVICE_KEY, value)
  }
  return value
}
