import { computed, reactive, ref } from 'vue'
import type { MockUser, UserRole } from '../types'
import { loadUser, saveUser } from '../storage'
import { surveyApi } from '../api'
import { useAppState } from './useAppState'

const currentUser = ref<MockUser | null>(loadUser())
const guestDraft = reactive({ gameId: '' })
const loginDraft = reactive({ displayName: 'Steve', gameId: 'Steve' })
const guestNameModalOpen = ref(false)
let guestNameResolve: ((confirmed: boolean) => void) | null = null

export function useAuth() {
  const { message } = useAppState()
  const isAdmin = computed(() => currentUser.value?.role === 'admin')

  const DEVICE_KEY = 'xducraft-survey-device-id-v1'
  const getDeviceId = () => {
    let v = localStorage.getItem(DEVICE_KEY)
    if (!v) { v = `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; localStorage.setItem(DEVICE_KEY, v) }
    return v
  }
  const anonymousUserId = computed(() => `anon-${getDeviceId()}`)
  const effectiveUserId = computed(() => currentUser.value?.id ?? anonymousUserId.value)
  const anonymousGameId = () => guestDraft.gameId.trim()
  const currentActorName = () => currentUser.value?.displayName ?? (anonymousGameId() || '匿名玩家')
  const currentGameId = () => currentUser.value?.gameId ?? anonymousGameId()

  const loginAs = async (role: UserRole) => {
    const displayName = loginDraft.displayName.trim() || loginDraft.gameId.trim() || 'Player'
    const gameId = loginDraft.gameId.trim() || displayName
    try {
      currentUser.value = await surveyApi.mockLogin({ displayName, gameId, role })
      saveUser(currentUser.value)
      message.success(role === 'admin' ? '已切换为管理员身份' : '已登录')
    } catch {
      message.error('登录失败，请确认 API 服务已启动。')
    }
  }

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
      currentUser.value = await surveyApi.consumeBlessingTicket(ticket!)
      saveUser(currentUser.value)
      message.success('已通过 Blessing Skin 登录')
    } catch {
      message.error('登录状态读取失败，请重新登录。')
    }
  }

  const startOAuthLogin = async (role: UserRole = 'player') => {
    try {
      const status = await surveyApi.blessingAuthStatus()
      if (!status.enabled) {
        message.warning('Blessing Skin OAuth 未配置，暂时使用 mock 登录。')
        await loginAs(role)
        return
      }
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`
      window.location.href = surveyApi.blessingLoginUrl(returnTo, role)
    } catch {
      message.warning('无法读取 OAuth 配置，暂时使用 mock 登录。')
      await loginAs(role)
    }
  }

  const logout = () => { currentUser.value = null; saveUser(null); message.info('已退出登录') }

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
    loginDraft,
    guestNameModalOpen,
    isAdmin,
    effectiveUserId,
    anonymousGameId,
    currentActorName,
    currentGameId,
    loginAs,
    startOAuthLogin,
    consumeAuthRedirect,
    logout,
    requestGuestName,
    confirmGuestName,
    cancelGuestName
  }
}
