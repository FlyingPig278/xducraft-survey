import { computed, reactive, ref } from 'vue'
import type { AuthUser, UserRole } from '../types'
import { getDeviceId, loadUser, saveUser } from '../storage'
import { surveyApi } from '../api'
import { useAppState } from './useAppState'

const currentUser = ref<AuthUser | null>(loadUser())
const guestDraft = reactive({ gameId: '' })
const guestNameModalOpen = ref(false)
let guestNameResolve: ((confirmed: boolean) => void) | null = null

export function useAuth() {
  const { loadAppState, message } = useAppState()
  const isAdmin = computed(() => currentUser.value?.role === 'admin')

  const anonymousUserId = computed(() => `anon-${getDeviceId()}`)
  const effectiveUserId = computed(() => currentUser.value?.id ?? anonymousUserId.value)
  const anonymousGameId = () => guestDraft.gameId.trim()
  const currentActorName = () => currentUser.value?.displayName ?? (anonymousGameId() || '匿名玩家')
  const currentGameId = () => currentUser.value?.gameId ?? anonymousGameId()

  const removeAuthQueryParams = () => {
    const url = new URL(window.location.href)
    url.searchParams.delete('auth_ticket')
    url.searchParams.delete('auth_error')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }

  const consumeAuthRedirect = async () => {
    const url = new URL(window.location.href)
    const ticket = url.searchParams.get('auth_ticket')
    const error = url.searchParams.get('auth_error')
    if (!ticket && !error) return
    removeAuthQueryParams()
    if (error) {
      message.error(error)
      return
    }
    try {
      const session = await surveyApi.consumeBlessingTicket(ticket!)
      currentUser.value = { ...session.user, sessionToken: session.sessionToken }
      saveUser(currentUser.value)
      if (currentUser.value.role === 'admin') {
        message.success('已登录管理员账号')
      } else if (window.location.hash.startsWith('#/admin')) {
        message.warning('登录成功，但当前账号没有管理员权限。')
      } else {
        message.success('已登录')
      }
    } catch {
      message.error('登录状态读取失败，请重新登录。')
    }
  }

  const startOAuthLogin = async (role: UserRole = 'player') => {
    try {
      const status = await surveyApi.blessingAuthStatus()
      if (!status.enabled) {
        message.error('XDUCraft 皮肤站登录未配置，无法登录。')
        return
      }
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`
      window.location.href = surveyApi.blessingLoginUrl(returnTo, role)
    } catch {
      message.error('无法读取皮肤站登录配置，请确认 API 服务已启动。')
    }
  }

  const logout = () => {
    currentUser.value = null
    saveUser(null)
    void loadAppState({ silent: true })
    message.info('已退出登录')
  }

  const requestGuestName = (): Promise<boolean> => {
    if (currentUser.value || guestDraft.gameId.trim()) return Promise.resolve(true)
    guestNameModalOpen.value = true
    return new Promise((resolve) => { guestNameResolve = resolve })
  }

  const confirmGuestName = () => {
    guestNameModalOpen.value = false
    guestNameResolve?.(true)
    guestNameResolve = null
  }

  const cancelGuestName = () => {
    guestNameModalOpen.value = false
    guestNameResolve?.(false)
    guestNameResolve = null
  }

  return {
    currentUser,
    guestDraft,
    guestNameModalOpen,
    isAdmin,
    effectiveUserId,
    anonymousGameId,
    currentActorName,
    currentGameId,
    startOAuthLogin,
    consumeAuthRedirect,
    logout,
    requestGuestName,
    confirmGuestName,
    cancelGuestName
  }
}
