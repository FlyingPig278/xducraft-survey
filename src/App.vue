<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NConfigProvider,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NProgress,
  NResult,
  NSelect,
  NSpace,
  NStatistic,
  NSwitch,
  NTag,
  createDiscreteApi,
  zhCN,
  dateZhCN
} from 'naive-ui'
import { surveyApi } from './api'
import { createId, createSeedState, loadUser, saveUser } from './storage'
import type {
  AppState,
  Candidate,
  CandidateStatus,
  FieldDefinition,
  FieldType,
  MockUser,
  ResultVisibility,
  SurveyDefinition,
  SurveyStatus,
  UserRole,
  VoteMode,
  VoteRecord
} from './types'

type AdminPanelKey = 'surveys' | 'preview' | 'fields' | 'candidates' | 'archive'
type CandidateFilter = CandidateStatus | 'all'
type RouteState = { mode: 'survey'; surveyId: string } | { mode: 'admin'; panel: AdminPanelKey; surveyId?: string }

interface ResultRow {
  candidate: Candidate
  count: number
  percent: number
}

const { message } = createDiscreteApi(['message'])

const appState = ref<AppState>(createSeedState())
const currentUser = ref<MockUser | null>(loadUser())
const hash = ref(window.location.hash)
const adminSurveyId = ref(appState.value.surveys[0]?.id ?? '')
const apiLoading = ref(true)
const apiError = ref('')
const stateRevision = ref(0)
const selectedCandidateIds = ref<string[]>([])
const statusMessage = ref('')
const submissionMessage = ref('')
const reviewNotes = ref<Record<string, string>>({})
const submissionValues = ref<Record<string, string>>({})
const voteConfirmOpen = ref(false)
const candidateModalOpen = ref(false)
const submittedSurveyId = ref('')
const editingVote = ref(false)
const candidateFilter = ref<CandidateFilter>('pending')
const draggedFieldId = ref('')

const guestDraft = reactive({ gameId: '' })

const loginDraft = reactive({
  displayName: 'Steve',
  gameId: 'Steve'
})

const newField = reactive({
  label: '',
  key: '',
  type: 'text' as FieldType,
  required: true,
  placeholder: '',
  optionsText: ''
})

const surveyDraft = reactive({
  title: '',
  description: '',
  guideText: '请先确认列表中是否已有你想玩的服务器。若没有，请选择列表末尾的自定义项提交候选，审核通过后再投票。',
  voteMode: 'multiple' as VoteMode,
  maxVotes: 3,
  resultVisibility: 'always' as ResultVisibility,
  allowVoteEdits: false,
  requireLogin: true,
  candidateSubmissionEnabled: true,
  candidateSubmissionRequiresReview: true,
  cloneCurrentFields: true
})

const surveySettingsDraft = reactive({
  title: '',
  description: '',
  guideText: '',
  status: 'draft' as SurveyStatus,
  voteMode: 'multiple' as VoteMode,
  maxVotes: 3,
  resultVisibility: 'always' as ResultVisibility,
  allowVoteEdits: false,
  requireLogin: true,
  candidateSubmissionEnabled: true,
  candidateSubmissionRequiresReview: true
})

const fieldDrafts = ref<FieldDefinition[]>([])

const defaultCandidateFieldTemplates: Array<Omit<FieldDefinition, 'id'>> = [
  { key: 'packName', label: '整合包名', type: 'text', required: true, placeholder: '例如 All the Mods 10' },
  { key: 'modloader', label: 'ModLoader', type: 'select', required: true, placeholder: '', options: ['Fabric', 'Forge', 'NeoForge', 'Quilt', 'Vanilla/DataPack'] },
  { key: 'gameVersion', label: '游戏版本', type: 'text', required: true, placeholder: '例如 1.20.1' },
  { key: 'category', label: '大致分类', type: 'select', required: true, placeholder: '', options: ['科技', '魔法', '冒险探索', '养老建筑', '专家包', '轻量休闲', '大型综合'] },
  { key: 'packUrl', label: '整合包链接', type: 'url', required: true, placeholder: 'CurseForge / Modrinth / 官网链接' },
  { key: 'videoUrl', label: '宣传视频', type: 'url', required: false, placeholder: 'Bilibili / YouTube 链接' },
  { key: 'notes', label: '推荐理由', type: 'textarea', required: false, placeholder: '为什么推荐它作为服务器方案' }
]

const adminPanels: Array<{ key: AdminPanelKey; label: string }> = [
  { key: 'surveys', label: '问卷管理' },
  { key: 'preview', label: '发布预览' },
  { key: 'fields', label: '字段配置' },
  { key: 'candidates', label: '候选审核' },
  { key: 'archive', label: '数据留档' }
]

const DEVICE_KEY = 'xducraft-survey-device-id-v1'
const defaultGuideText = '请先确认列表中是否已有你想玩的服务器。若没有，请选择列表末尾的自定义项提交候选，审核通过后再投票。'

const parseHash = (value: string): RouteState => {
  const clean = value.replace(/^#\/?/, '')
  const segments = clean.split('/').filter(Boolean)
  if (segments[0] === 'admin') {
    const panel = adminPanels.some((item) => item.key === segments[1]) ? (segments[1] as AdminPanelKey) : 'surveys'
    return { mode: 'admin', panel, surveyId: segments[2] }
  }
  if (segments[0] === 's' && segments[1]) return { mode: 'survey', surveyId: segments[1] }
  return { mode: 'survey', surveyId: appState.value.surveys[0]?.id ?? '' }
}

const route = computed(() => parseHash(hash.value))
const surveys = computed(() => [...appState.value.surveys].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const activeSurveyId = computed(() => route.value.mode === 'survey' ? route.value.surveyId : adminSurveyId.value)
const survey = computed<SurveyDefinition>(() => {
  const s = appState.value.surveys.find((item) => item.id === activeSurveyId.value)
  return s ?? appState.value.surveys[0]!
})
const adminPanel = computed(() => (route.value.mode === 'admin' ? route.value.panel : 'surveys'))
const isAdminRoute = computed(() => route.value.mode === 'admin')
const isAdmin = computed(() => currentUser.value?.role === 'admin')

const surveyById = (id: string) => appState.value.surveys.find((item) => item.id === id)
const surveyTitleById = (id: string) => surveyById(id)?.title ?? '未知问卷'
const surveyCandidates = computed(() => appState.value.candidates.filter((c) => c.surveyId === survey.value.id))
const surveyVotes = computed(() => appState.value.votes.filter((v) => v.surveyId === survey.value.id))
const approvedCandidates = computed(() => surveyCandidates.value.filter((c) => c.status === 'approved'))
const pendingCandidateCount = computed(() => appState.value.candidates.filter((c) => c.status === 'pending').length)
const voteLimit = computed(() => (survey.value.voteMode === 'single' ? 1 : Math.max(1, survey.value.maxVotes || 1)))

const getDeviceId = () => {
  let v = localStorage.getItem(DEVICE_KEY)
  if (!v) { v = createId('device'); localStorage.setItem(DEVICE_KEY, v) }
  return v
}
const anonymousUserId = computed(() => `anon-${getDeviceId()}`)
const effectiveUserId = computed(() => currentUser.value?.id ?? anonymousUserId.value)
const currentVote = computed(() => {
  if (survey.value.requireLogin && !currentUser.value) return null
  return surveyVotes.value.find((v) => v.userId === effectiveUserId.value) ?? null
})
const approvedCandidateIds = computed(() => new Set(approvedCandidates.value.map((c) => c.id)))
const selectedCandidates = computed(() =>
  selectedCandidateIds.value.map((id) => approvedCandidates.value.find((c) => c.id === id)).filter((c): c is Candidate => Boolean(c))
)
const totalVoters = computed(() => surveyVotes.value.length)
const totalSelections = computed(() => surveyVotes.value.reduce((t, v) => t + v.candidateIds.length, 0))
const candidateCounts = computed(() => {
  const counts = new Map<string, number>()
  surveyVotes.value.forEach((v) => { v.candidateIds.forEach((id) => { counts.set(id, (counts.get(id) ?? 0) + 1) }) })
  return counts
})
const resultRows = computed<ResultRow[]>(() =>
  approvedCandidates.value
    .map((c) => {
      const count = candidateCounts.value.get(c.id) ?? 0
      const percent = totalVoters.value > 0 ? Math.round((count / totalVoters.value) * 100) : 0
      return { candidate: c, count, percent }
    })
    .sort((a, b) => b.count - a.count || a.candidate.title.localeCompare(b.candidate.title))
)
const hasSubmittedCurrentSurvey = computed(() => Boolean(currentVote.value) || submittedSurveyId.value === survey.value.id)
const showSubmissionSummary = computed(() => hasSubmittedCurrentSurvey.value && !editingVote.value)
const latestVote = computed(() => [...surveyVotes.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null)
const adminCandidateRows = computed(() => {
  const rows = candidateFilter.value === 'all' ? appState.value.candidates : appState.value.candidates.filter((c) => c.status === candidateFilter.value)
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
})
const publicSurveyUrl = computed(() => `${window.location.origin}${window.location.pathname}#/s/${survey.value.id}`)
const publicSurveyQrUrl = computed(() => `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(publicSurveyUrl.value)}`)
const surveyGuideText = computed(() => survey.value.guideText || defaultGuideText)
const surveyHasVotes = computed(() => surveyVotes.value.length > 0)
const surveyHasCandidates = computed(() => surveyCandidates.value.length > 0)

const settingsSnapshot = (item: SurveyDefinition) => JSON.stringify({
  title: item.title,
  description: item.description,
  guideText: item.guideText,
  status: item.status,
  voteMode: item.voteMode,
  maxVotes: item.maxVotes,
  resultVisibility: item.resultVisibility,
  allowVoteEdits: item.allowVoteEdits,
  requireLogin: item.requireLogin,
  candidateSubmissionEnabled: item.candidateSubmission.enabled,
  candidateSubmissionRequiresReview: item.candidateSubmission.requiresReview
})
const settingsDraftSnapshot = () => JSON.stringify(surveySettingsDraft)
const surveySettingsDirty = computed(() => settingsSnapshot(survey.value) !== settingsDraftSnapshot())
const fieldsDirty = computed(() => JSON.stringify(survey.value.candidateFields) !== JSON.stringify(fieldDrafts.value))
const canViewResultsBeforeVote = computed(() => survey.value.resultVisibility === 'always')
const canViewResultsAfterVote = computed(() => survey.value.resultVisibility === 'always' || (survey.value.resultVisibility === 'after_vote' && hasSubmittedCurrentSurvey.value))

const surveySelectOptions = computed(() => surveys.value.map((s) => ({ label: s.title, value: s.id })))
const voteModeOptions = [{ label: '单选', value: 'single' }, { label: '多选', value: 'multiple' }]
const statusOptions = [{ label: '草稿', value: 'draft' }, { label: '开放', value: 'open' }, { label: '已关闭', value: 'closed' }]
const resultVisibilityOptions = [
  { label: '投票前后均显示', value: 'always' },
  { label: '投票后显示', value: 'after_vote' },
  { label: '不对玩家显示', value: 'hidden' }
]
const fieldTypeOptions = [{ label: 'text', value: 'text' }, { label: 'textarea', value: 'textarea' }, { label: 'url', value: 'url' }, { label: 'select', value: 'select' }, { label: 'number', value: 'number' }]

const publicSurveyUrlFor = (id: string) => `${window.location.origin}${window.location.pathname}#/s/${id}`
const navigateSurvey = (id: string) => { window.location.hash = `#/s/${id}` }
const navigateAdmin = (panel: AdminPanelKey, surveyId = adminSurveyId.value) => {
  window.location.hash = surveyId ? `#/admin/${panel}/${surveyId}` : `#/admin/${panel}`
}
const openPublicSurvey = (id = activeSurveyId.value) => { window.open(publicSurveyUrlFor(id), '_blank', 'noopener,noreferrer') }
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
  } catch (error) {
    apiError.value = error instanceof Error ? error.message : '无法连接 API 服务'
    message.error('无法连接 API 服务，请确认后端已启动。')
  } finally {
    apiLoading.value = false
  }
}

const persist = async (preferredSurveyId = activeSurveyId.value) => {
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

const addAudit = (action: string, detail: string, actor = currentUser.value?.displayName ?? 'System') => {
  appState.value.auditLogs.unshift({ id: createId('log'), action, actor, detail, createdAt: new Date().toISOString() })
}

const formatDate = (value?: string) => {
  if (!value) return '未记录'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')

const statusLabel = (status: SurveyStatus | CandidateStatus) => {
  const labels: Record<string, string> = { draft: '草稿', open: '开放', closed: '已关闭', pending: '待审核', approved: '已通过', rejected: '已拒绝' }
  return labels[status] ?? status
}

const statusTagType = (status: string): 'success' | 'warning' | 'error' | 'info' | 'default' => {
  const types: Record<string, 'success' | 'warning' | 'error' | 'info' | 'default'> = { draft: 'default', open: 'success', closed: 'error', pending: 'warning', approved: 'success', rejected: 'error' }
  return types[status] ?? 'default'
}

const buildKey = (label: string, fallbackIndex = Math.max(fieldDrafts.value.length, survey.value.candidateFields.length) + 1) => {
  const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return key || `custom_field_${fallbackIndex}`
}

const cloneField = (f: FieldDefinition): FieldDefinition => ({ ...f, id: f.id || createId('field'), options: f.options ? [...f.options] : undefined })
const fieldOptions = (field: FieldDefinition) => field.options?.filter(Boolean) ?? []
const fieldSelectOptions = (field: FieldDefinition) => fieldOptions(field).map((o) => ({ label: o, value: o }))

const validateUrl = (value: string) => {
  if (!value.trim()) return true
  try { new URL(value); return true } catch { return false }
}

const candidateTitleById = (id: string) => approvedCandidates.value.find((c) => c.id === id)?.title ?? '未知候选项'

const candidateMetaFor = (candidate: Candidate, ownerSurvey = surveyById(candidate.surveyId)) =>
  (ownerSurvey?.candidateFields ?? [])
    .filter((f) => f.key !== 'packName' && f.type !== 'textarea' && f.type !== 'url')
    .slice(0, 3)
    .map((f) => candidate.fields[f.key])
    .filter(Boolean)
    .join(' / ')

const candidateMeta = (candidate: Candidate) => candidateMetaFor(candidate, survey.value)
const candidateReviewFields = (candidate: Candidate) => {
  const ownerSurvey = surveyById(candidate.surveyId)
  const fields = ownerSurvey?.candidateFields ?? []
  if (fields.length === 0) return Object.entries(candidate.fields).map(([key, value]) => ({ key, label: key, value }))
  return fields.map((field) => ({ key: field.key, label: field.label, value: candidate.fields[field.key] || '未填' }))
}
const countForCandidate = (id: string) => candidateCounts.value.get(id) ?? 0
const percentForCandidate = (id: string) => totalVoters.value > 0 ? Math.round((countForCandidate(id) / totalVoters.value) * 100) : 0

const syncSurveySettingsDraft = () => {
  Object.assign(surveySettingsDraft, {
    title: survey.value.title,
    description: survey.value.description,
    guideText: survey.value.guideText,
    status: survey.value.status,
    voteMode: survey.value.voteMode,
    maxVotes: survey.value.maxVotes,
    resultVisibility: survey.value.resultVisibility,
    allowVoteEdits: survey.value.allowVoteEdits,
    requireLogin: survey.value.requireLogin,
    candidateSubmissionEnabled: survey.value.candidateSubmission.enabled,
    candidateSubmissionRequiresReview: survey.value.candidateSubmission.requiresReview
  })
}

const syncFieldDrafts = () => {
  fieldDrafts.value = survey.value.candidateFields.map(cloneField)
}

const initSubmissionValues = () => {
  const next: Record<string, string> = {}
  survey.value.candidateFields.forEach((f) => { next[f.key] = submissionValues.value[f.key] ?? '' })
  submissionValues.value = next
}

const resetSubmissionValues = () => {
  const next: Record<string, string> = {}
  survey.value.candidateFields.forEach((f) => { next[f.key] = '' })
  submissionValues.value = next
}

const syncSelectionFromVote = () => {
  selectedCandidateIds.value = currentVote.value ? currentVote.value.candidateIds.filter((id) => approvedCandidateIds.value.has(id)) : []
}

const handleHashChange = () => { hash.value = window.location.hash }

onMounted(() => {
  window.addEventListener('hashchange', handleHashChange)
  if (!window.location.hash) navigateSurvey(appState.value.surveys[0]?.id ?? '')
  void loadAppState()
})
onBeforeUnmount(() => { window.removeEventListener('hashchange', handleHashChange) })

watch(() => appState.value.surveys.map((s) => s.id).join('|'), () => {
  if (!appState.value.surveys.some((s) => s.id === adminSurveyId.value)) adminSurveyId.value = appState.value.surveys[0]?.id ?? ''
  if (route.value.mode === 'survey' && !appState.value.surveys.some((s) => s.id === activeSurveyId.value)) navigateSurvey(appState.value.surveys[0]?.id ?? '')
}, { immediate: true })

watch(() => (route.value.mode === 'admin' ? route.value.surveyId : undefined), (routeSurveyId) => {
  if (routeSurveyId && appState.value.surveys.some((item) => item.id === routeSurveyId)) {
    adminSurveyId.value = routeSurveyId
  }
}, { immediate: true })

watch(() => survey.value.id, () => {
  syncSurveySettingsDraft(); syncFieldDrafts(); initSubmissionValues(); syncSelectionFromVote(); statusMessage.value = ''; submissionMessage.value = ''; voteConfirmOpen.value = false; candidateModalOpen.value = false; editingVote.value = false
}, { immediate: true })

watch(currentUser, syncSelectionFromVote, { immediate: true })
watch(() => `${survey.value.id}:${survey.value.candidateFields.map((f) => `${f.id}:${f.key}`).join('|')}`, initSubmissionValues, { immediate: true })
watch(() => `${survey.value.id}:${surveyVotes.value.map((v) => `${v.userId}:${v.updatedAt}`).join('|')}`, syncSelectionFromVote)
watch(() => approvedCandidates.value.map((c) => c.id).join('|'), () => {
  selectedCandidateIds.value = selectedCandidateIds.value.filter((id) => approvedCandidateIds.value.has(id))
})

const loginAs = async (role: UserRole) => {
  const displayName = loginDraft.displayName.trim() || loginDraft.gameId.trim() || 'Player'
  const gameId = loginDraft.gameId.trim() || displayName
  try {
    currentUser.value = await surveyApi.mockLogin({ displayName, gameId, role })
    saveUser(currentUser.value)
    message.success(role === 'admin' ? '已切换为管理员身份' : '已登录')
    syncSelectionFromVote()
  } catch {
    message.error('登录失败，请确认 API 服务已启动。')
  }
}

const startOAuthLogin = (role: UserRole = 'player') => { void loginAs(role) }

const logout = () => { currentUser.value = null; saveUser(null); message.info('已退出登录') }

const anonymousGameId = () => guestDraft.gameId.trim()

const hasVoteIdentity = () => {
  if (survey.value.requireLogin) {
    if (!currentUser.value) { startOAuthLogin('player'); message.info('已进入 mock OAuth 登录，请再次确认操作。'); return false }
    return true
  }
  if (currentUser.value) return true
  if (!anonymousGameId()) { message.warning('请填写游戏昵称用于留档。'); return false }
  return true
}

const currentActorName = () => currentUser.value?.displayName ?? (anonymousGameId() || '匿名玩家')
const currentGameId = () => currentUser.value?.gameId ?? anonymousGameId()
const isSelected = (id: string) => selectedCandidateIds.value.includes(id)

const toggleCandidate = (candidateId: string) => {
  statusMessage.value = ''
  if (hasSubmittedCurrentSurvey.value && !survey.value.allowVoteEdits) return
  if (survey.value.status !== 'open') { message.warning('当前问卷不在开放投票状态。'); return }
  if (!approvedCandidateIds.value.has(candidateId)) return
  if (survey.value.voteMode === 'single') { selectedCandidateIds.value = isSelected(candidateId) ? [] : [candidateId]; return }
  if (isSelected(candidateId)) { selectedCandidateIds.value = selectedCandidateIds.value.filter((id) => id !== candidateId); return }
  if (selectedCandidateIds.value.length >= voteLimit.value) { message.warning(`最多选择 ${voteLimit.value} 项。`); return }
  selectedCandidateIds.value = [...selectedCandidateIds.value, candidateId]
}

const openVoteConfirm = () => {
  statusMessage.value = ''
  if (!hasVoteIdentity()) return
  if (survey.value.status !== 'open') { message.warning('当前问卷不在开放投票状态。'); return }
  if (currentVote.value && !survey.value.allowVoteEdits) { message.warning('你已经提交过本问卷，当前不允许修改。'); return }
  if (selectedCandidateIds.value.length === 0) { message.warning('请至少选择一个候选项。'); return }
  voteConfirmOpen.value = true
}

const openCandidateModal = () => {
  submissionMessage.value = ''
  if (survey.value.requireLogin && !currentUser.value) { startOAuthLogin('player'); message.info('已进入 mock OAuth 登录，请再次打开自定义表单。'); return }
  candidateModalOpen.value = true
}

const confirmSubmitVote = async () => {
  if (!hasVoteIdentity()) return
  const valid = selectedCandidateIds.value.filter((id) => approvedCandidateIds.value.has(id))
  selectedCandidateIds.value = [...new Set(valid)]
  if (selectedCandidateIds.value.length === 0 || selectedCandidateIds.value.length > voteLimit.value) return
  const surveyId = survey.value.id
  const ts = new Date().toISOString()
  if (currentVote.value) {
    currentVote.value.history.push({ candidateIds: [...currentVote.value.candidateIds], changedAt: currentVote.value.updatedAt })
    currentVote.value.candidateIds = [...selectedCandidateIds.value]
    currentVote.value.updatedAt = ts
    addAudit('vote.updated', `${currentActorName()} 修改了「${survey.value.title}」的投票`)
  } else {
    appState.value.votes.push({ id: createId('vote'), surveyId: survey.value.id, userId: effectiveUserId.value, userName: currentActorName(), gameId: currentGameId(), candidateIds: [...selectedCandidateIds.value], createdAt: ts, updatedAt: ts, history: [] })
    addAudit('vote.created', `${currentActorName()} 提交了「${survey.value.title}」的投票`)
  }
  if (!(await persist(surveyId))) return
  voteConfirmOpen.value = false
  submittedSurveyId.value = surveyId
  editingVote.value = false
  statusMessage.value = '提交成功'
}

const submitCandidate = async () => {
  submissionMessage.value = ''
  if (!hasVoteIdentity()) { submissionMessage.value = survey.value.requireLogin ? '请先登录' : '请填写游戏昵称'; return }
  if (survey.value.status !== 'open' || !survey.value.candidateSubmission.enabled) { submissionMessage.value = '当前问卷没有开放候选项投稿。'; return }
  const surveyId = survey.value.id
  for (const field of survey.value.candidateFields) {
    const val = submissionValues.value[field.key]?.trim() ?? ''
    if (field.required && !val) { submissionMessage.value = `请填写「${field.label}」。`; return }
    if (field.type === 'url' && !validateUrl(val)) { submissionMessage.value = `「${field.label}」需要是完整链接。`; return }
  }
  const title = submissionValues.value.packName?.trim() || submissionValues.value.name?.trim() || submissionValues.value.title?.trim() || survey.value.candidateFields.map((f) => submissionValues.value[f.key]).find(Boolean)?.trim() || '未命名候选项'
  if (appState.value.candidates.find((c) => c.surveyId === survey.value.id && c.status !== 'rejected' && normalize(c.title) === normalize(title))) { submissionMessage.value = '已经存在同名候选项。'; return }
  const ts = new Date().toISOString()
  const status: CandidateStatus = survey.value.candidateSubmission.requiresReview ? 'pending' : 'approved'
  appState.value.candidates.unshift({ id: createId('candidate'), surveyId: survey.value.id, title, status, fields: { ...submissionValues.value }, submitterUserId: effectiveUserId.value, submitterName: currentActorName(), createdAt: ts, reviewedAt: status === 'approved' ? ts : undefined, reviewerName: status === 'approved' ? 'Auto Review' : undefined })
  addAudit('candidate.submitted', `${currentActorName()} 投稿了「${title}」`)
  if (!(await persist(surveyId))) return
  resetSubmissionValues()
  candidateModalOpen.value = false
  message.success(status === 'pending' ? '候选项已提交，等待管理员审核。' : '候选项已进入投票列表。')
}

const setCandidateStatus = async (candidate: Candidate, status: CandidateStatus) => {
  if (!isAdmin.value || !currentUser.value) { message.error('请先登录管理员身份。'); return }
  const surveyId = candidate.surveyId
  candidate.status = status
  candidate.reviewedAt = new Date().toISOString()
  candidate.reviewerName = currentUser.value.displayName
  candidate.reviewNote = reviewNotes.value[candidate.id] ?? candidate.reviewNote ?? ''
  addAudit(`candidate.${status}`, `${currentUser.value.displayName} 将「${candidate.title}」标记为${statusLabel(status)}`)
  if (!(await persist(surveyId))) return
  message.success(`「${candidate.title}」已标记为${statusLabel(status)}`)
}

const duplicateField = (f: FieldDefinition): FieldDefinition => ({ ...f, id: createId('field'), options: f.options ? [...f.options] : undefined })
const createDefaultCandidateFields = (): FieldDefinition[] => defaultCandidateFieldTemplates.map((f) => ({ ...f, id: createId('field'), options: f.options ? [...f.options] : undefined }))

const saveSurveySettings = async (successText = '问卷设置已保存') => {
  if (!isAdmin.value || !currentUser.value) { message.error('请先登录管理员身份。'); return false }
  const title = surveySettingsDraft.title.trim()
  if (!title) { message.warning('请填写问卷标题。'); return false }
  const surveyId = survey.value.id
  survey.value.title = title
  survey.value.description = surveySettingsDraft.description.trim() || '请选择你愿意参与的服务器方案。'
  survey.value.guideText = surveySettingsDraft.guideText.trim() || defaultGuideText
  survey.value.status = surveySettingsDraft.status
  survey.value.voteMode = surveySettingsDraft.voteMode
  survey.value.maxVotes = Math.max(1, Number(surveySettingsDraft.maxVotes) || 1)
  survey.value.resultVisibility = surveySettingsDraft.resultVisibility
  survey.value.allowVoteEdits = surveySettingsDraft.allowVoteEdits
  survey.value.requireLogin = surveySettingsDraft.requireLogin
  survey.value.candidateSubmission = {
    enabled: surveySettingsDraft.candidateSubmissionEnabled,
    requiresReview: surveySettingsDraft.candidateSubmissionRequiresReview
  }
  survey.value.updatedAt = new Date().toISOString()
  addAudit('survey.settings_saved', `${currentUser.value.displayName} 保存了问卷「${survey.value.title}」的设置`)
  if (!(await persist(surveyId))) return false
  syncSurveySettingsDraft()
  message.success(successText)
  return true
}

const publishSurvey = async () => {
  surveySettingsDraft.status = 'open'
  await saveSurveySettings('问卷已发布，公开链接现在可访问。')
}

const addField = () => {
  const label = newField.label.trim()
  if (!label) { message.warning('请先填写字段名称。'); return }
  const key = (newField.key.trim() || buildKey(label)).replace(/[^a-zA-Z0-9_]/g, '_')
  if (fieldDrafts.value.some((f) => f.key === key)) { message.warning('字段 key 已存在。'); return }
  fieldDrafts.value = [...fieldDrafts.value, { id: createId('field'), key, label, type: newField.type, required: newField.required, placeholder: newField.placeholder.trim(), options: newField.optionsText.split('\n').map((o) => o.trim()).filter(Boolean) }]
  newField.label = ''; newField.key = ''; newField.type = 'text'; newField.required = true; newField.placeholder = ''; newField.optionsText = ''
  message.success('字段已加入草稿，请保存后生效。')
}

const removeField = (field: FieldDefinition) => {
  fieldDrafts.value = fieldDrafts.value.filter((f) => f.id !== field.id)
}

const moveField = (fieldId: string, offset: number) => {
  const fields = [...fieldDrafts.value]
  const idx = fields.findIndex((f) => f.id === fieldId)
  const next = idx + offset
  if (idx < 0 || next < 0 || next >= fields.length) return
  const [f] = fields.splice(idx, 1)
  fields.splice(next, 0, f)
  fieldDrafts.value = fields
}

const dropFieldBefore = (targetId: string) => {
  const srcId = draggedFieldId.value; draggedFieldId.value = ''
  if (!srcId || srcId === targetId) return
  const fields = [...fieldDrafts.value]
  const si = fields.findIndex((f) => f.id === srcId)
  const ti = fields.findIndex((f) => f.id === targetId)
  if (si < 0 || ti < 0) return
  const [f] = fields.splice(si, 1)
  fields.splice(si < ti ? ti - 1 : ti, 0, f)
  fieldDrafts.value = fields
}

const updateFieldOptions = (field: FieldDefinition, value: string) => {
  field.options = value.split('\n').map((o) => o.trim()).filter(Boolean)
}

const saveFieldDrafts = async (successText = '字段配置已保存') => {
  if (!isAdmin.value || !currentUser.value) { message.error('请先登录管理员身份。'); return }
  const surveyId = survey.value.id
  const normalized = fieldDrafts.value.map((field, index) => ({
    ...field,
    label: field.label.trim(),
    key: (field.key.trim() || buildKey(field.label, index + 1)).replace(/[^a-zA-Z0-9_]/g, '_'),
    placeholder: field.placeholder?.trim() ?? '',
    options: fieldOptions(field)
  }))
  if (normalized.some((field) => !field.label || !field.key)) { message.warning('字段名称和 Key 不能为空。'); return }
  const keySet = new Set<string>()
  for (const field of normalized) {
    if (keySet.has(field.key)) { message.warning(`字段 key「${field.key}」重复。`); return }
    keySet.add(field.key)
  }
  survey.value.candidateFields = normalized.map(cloneField)
  survey.value.updatedAt = new Date().toISOString()
  addAudit('survey.fields_saved', `${currentUser.value.displayName} 保存了问卷「${survey.value.title}」的投稿字段`)
  if (!(await persist(surveyId))) return false
  syncFieldDrafts()
  initSubmissionValues()
  message.success(successText)
  return true
}

const createSurvey = async () => {
  if (!isAdmin.value || !currentUser.value) { message.error('请先登录管理员身份。'); return }
  const title = surveyDraft.title.trim()
  if (!title) { message.warning('请填写新问卷标题。'); return }
  const ts = new Date().toISOString()
  const fields = surveyDraft.cloneCurrentFields ? survey.value.candidateFields.map(duplicateField) : createDefaultCandidateFields()
  const next: SurveyDefinition = {
    id: createId('survey'), title, description: surveyDraft.description.trim() || '请选择你愿意参与的服务器方案。',
    guideText: surveyDraft.guideText.trim() || defaultGuideText, status: 'draft', resultVisibility: surveyDraft.resultVisibility,
    allowVoteEdits: surveyDraft.allowVoteEdits, requireLogin: surveyDraft.requireLogin, voteMode: surveyDraft.voteMode,
    maxVotes: Math.max(1, Number(surveyDraft.maxVotes) || 1),
    candidateSubmission: { enabled: surveyDraft.candidateSubmissionEnabled, requiresReview: surveyDraft.candidateSubmissionRequiresReview },
    candidateFields: fields, createdAt: ts, updatedAt: ts
  }
  appState.value.surveys.unshift(next)
  adminSurveyId.value = next.id
  surveyDraft.title = ''; surveyDraft.description = ''; surveyDraft.guideText = defaultGuideText
  addAudit('survey.created', `${currentUser.value.displayName} 创建了问卷「${next.title}」`)
  if (!(await persist(next.id))) return
  syncSurveySettingsDraft()
  syncFieldDrafts()
  message.success(`问卷「${next.title}」已创建，开始配置投稿字段。`)
  navigateAdmin('fields', next.id)
}

const openPreview = async () => {
  if (surveySettingsDirty.value && !(await saveSurveySettings('问卷设置已保存'))) return
  if (fieldsDirty.value && !(await saveFieldDrafts('字段配置已保存'))) return
  navigateAdmin('preview', activeSurveyId.value)
}

const resetDemo = async () => {
  try {
    stateRevision.value += 1
    applyRemoteState(await surveyApi.resetState(), '')
    if (!isAdminRoute.value) navigateSurvey(appState.value.surveys[0]?.id ?? '')
    else navigateAdmin('surveys')
    syncSurveySettingsDraft()
    syncFieldDrafts()
    initSubmissionValues(); syncSelectionFromVote()
    message.success('演示数据已重置')
  } catch {
    message.error('重置失败，请确认 API 服务已启动。')
  }
}

const copyPublicLink = async () => {
  try { await navigator.clipboard.writeText(publicSurveyUrl.value); message.success('链接已复制') } catch { message.info(publicSurveyUrl.value) }
}

const csvEscape = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`
const exportResultsCsv = () => {
  const h = ['问卷', '候选项', '状态', '票数', '投稿人', '创建时间', ...survey.value.candidateFields.map((f) => f.label)]
  const rows = surveyCandidates.value.map((c) => [survey.value.title, c.title, statusLabel(c.status), candidateCounts.value.get(c.id) ?? 0, c.submitterName, c.createdAt, ...survey.value.candidateFields.map((f) => c.fields[f.key] ?? '')])
  downloadFile('xducraft-survey-results.csv', [h, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n'), 'text/csv;charset=utf-8')
}
const exportVotesCsv = () => {
  const h = ['问卷', '玩家', '游戏 ID', '选择', '创建时间', '更新时间', '历史版本数']
  const rows = surveyVotes.value.map((v) => [survey.value.title, v.userName, v.gameId, v.candidateIds.map(candidateTitleById).join(' / '), v.createdAt, v.updatedAt, v.history.length])
  downloadFile('xducraft-survey-votes.csv', [h, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n'), 'text/csv;charset=utf-8')
}
const exportJson = () => {
  downloadFile('xducraft-survey-archive.json', JSON.stringify({ survey: survey.value, candidates: surveyCandidates.value, votes: surveyVotes.value, auditLogs: appState.value.auditLogs }, null, 2), 'application/json')
}
const downloadFile = (name: string, content: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
}
</script>

<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN">
    <!-- ==================== VOTING PAGE ==================== -->
    <main v-if="!isAdminRoute" class="survey-page">
      <header class="survey-topbar">
        <span class="survey-topbar-brand">XDUCraft Vote</span>
        <n-space align="center" :size="12">
          <template v-if="currentUser">
            <n-tag :bordered="false" size="small">{{ currentUser.displayName }}</n-tag>
            <n-button size="small" quaternary @click="logout">退出</n-button>
          </template>
          <n-button v-else size="small" @click="startOAuthLogin('player')">登录</n-button>
        </n-space>
      </header>

      <div class="survey-container">
        <n-alert v-if="apiError" type="error" :bordered="false" style="margin-bottom: 16px">
          API 连接失败：{{ apiError }}
        </n-alert>
        <n-alert v-else-if="apiLoading" type="info" :bordered="false" style="margin-bottom: 16px">
          正在同步问卷数据...
        </n-alert>
        <n-card>
          <template #header>
            <n-space align="center" :size="12">
              <span style="font-size: 22px; font-weight: 700">{{ survey.title }}</span>
              <n-tag :type="statusTagType(survey.status)" size="small" round>{{ statusLabel(survey.status) }}</n-tag>
            </n-space>
          </template>
          <template #header-extra>
            <n-tag v-if="survey.voteMode === 'single'" size="small" :bordered="false">单选</n-tag>
            <n-tag v-else size="small" :bordered="false">最多 {{ voteLimit }} 项</n-tag>
          </template>

          <p style="color: #64748b; margin: 0 0 20px; line-height: 1.6">{{ surveyGuideText }}</p>

          <!-- Guest name input -->
          <div v-if="!survey.requireLogin && !currentUser" style="margin-bottom: 16px">
            <n-form-item label="游戏昵称" :show-feedback="false">
              <n-input v-model:value="guestDraft.gameId" placeholder="用于留档和本地去重" />
            </n-form-item>
          </div>

          <!-- Submitted view -->
          <template v-if="showSubmissionSummary">
            <n-result
              status="success"
              title="投票已提交"
              :description="canViewResultsAfterVote ? `${totalVoters} 名玩家已参与，共 ${totalSelections} 个选择` : '你的选择已记录，票数结果由管理员控制是否公开。'"
              style="padding: 16px 0"
            />
            <template v-if="canViewResultsAfterVote">
              <n-space vertical :size="8">
                <div v-for="row in resultRows" :key="row.candidate.id" class="result-item">
                  <div class="result-item-info">
                    <div class="result-item-title">{{ row.candidate.title }}</div>
                    <div class="result-item-meta">{{ candidateMeta(row.candidate) || '未填写补充信息' }}</div>
                    <n-progress :percentage="row.percent" :show-indicator="false" :height="6" style="margin-top: 8px" :color="'#6366f1'" :rail-color="'#e2e8f0'" />
                  </div>
                  <div class="result-item-count">{{ row.count }} 票 <span style="color: #94a3b8; font-weight: 400; font-size: 13px">({{ row.percent }}%)</span></div>
                </div>
              </n-space>
            </template>
            <n-alert v-else type="info" :bordered="false">
              本问卷未公开实时票数。管理员仍可在后台留档和导出完整结果。
            </n-alert>
            <n-space v-if="survey.allowVoteEdits && survey.status === 'open'" justify="end" style="margin-top: 18px">
              <n-button type="primary" @click="editingVote = true">修改投票</n-button>
            </n-space>
          </template>

          <!-- Voting view -->
          <template v-else>
            <n-space vertical :size="8">
              <div
                v-for="candidate in approvedCandidates"
                :key="candidate.id"
                class="candidate-card"
                :class="{ selected: isSelected(candidate.id) }"
                @click="toggleCandidate(candidate.id)"
              >
                <div class="candidate-card-check" :class="{ active: isSelected(candidate.id) }"></div>
                <div class="candidate-card-body">
                  <div class="candidate-card-title">{{ candidate.title }}</div>
                  <div class="candidate-card-meta">{{ candidateMeta(candidate) || '未填写补充信息' }}</div>
                  <div v-if="canViewResultsBeforeVote" class="candidate-card-stats">
                    <n-progress :percentage="percentForCandidate(candidate.id)" :show-indicator="false" :height="5" :color="'#6366f1'" :rail-color="'#e2e8f0'" />
                  </div>
                </div>
                <div v-if="canViewResultsBeforeVote" class="candidate-card-count">
                  <strong>{{ countForCandidate(candidate.id) }}</strong>
                  <span>票</span>
                </div>
              </div>

              <div
                v-if="survey.candidateSubmission.enabled"
                class="candidate-card custom-card"
                @click="openCandidateModal"
              >
                <div class="candidate-card-check candidate-card-plus"></div>
                <div class="candidate-card-body">
                  <div class="candidate-card-title">自定义候选项</div>
                  <div class="candidate-card-meta">新增候选项会进入审核，通过后可被投票</div>
                </div>
              </div>
            </n-space>

            <div class="submit-footer">
              <n-tag :bordered="false" round>
                已选 {{ selectedCandidateIds.length }} / {{ voteLimit }}
              </n-tag>
              <n-button type="primary" @click="openVoteConfirm" :disabled="selectedCandidateIds.length === 0">
                {{ currentVote ? '提交修改' : '提交投票' }}
              </n-button>
            </div>
          </template>
        </n-card>
      </div>

      <!-- Vote confirmation modal -->
      <n-modal v-model:show="voteConfirmOpen" preset="dialog" title="确认提交投票？" positive-text="确认提交" negative-text="返回检查" @positive-click="confirmSubmitVote" @negative-click="voteConfirmOpen = false">
        <p style="color: #64748b">提交后默认不能修改，请确认你的选择无误。</p>
        <n-space vertical :size="6">
          <n-tag v-for="c in selectedCandidates" :key="c.id" :bordered="false" type="info" round>{{ c.title }}</n-tag>
        </n-space>
      </n-modal>

      <!-- Candidate submission modal -->
      <n-modal v-model:show="candidateModalOpen" preset="card" title="提交自定义候选项" style="width: 680px; max-width: 95vw" :bordered="true">
        <template #header-extra>
          <n-tag :bordered="false" size="small">审核通过后出现在投票列表</n-tag>
        </template>
        <n-form label-placement="top" :show-feedback="false">
          <div class="modal-form-grid">
            <n-form-item
              v-for="field in survey.candidateFields"
              :key="field.id"
              :label="`${field.label}${field.required ? ' *' : ''}`"
              :class="{ 'modal-form-full': field.type === 'textarea' }"
            >
              <n-select
                v-if="field.type === 'select'"
                v-model:value="submissionValues[field.key]"
                :options="fieldSelectOptions(field)"
                placeholder="请选择"
              />
              <n-input
                v-else-if="field.type === 'textarea'"
                v-model:value="submissionValues[field.key]"
                type="textarea"
                :rows="3"
                :placeholder="field.placeholder"
              />
              <n-input
                v-else
                v-model:value="submissionValues[field.key]"
                :placeholder="field.placeholder"
              />
            </n-form-item>
          </div>
          <n-alert v-if="submissionMessage" type="warning" style="margin-top: 16px" :bordered="false">{{ submissionMessage }}</n-alert>
          <n-space justify="end" style="margin-top: 20px" :size="12">
            <n-button @click="resetSubmissionValues">重置</n-button>
            <n-button type="primary" @click="submitCandidate">提交审核</n-button>
          </n-space>
        </n-form>
      </n-modal>
    </main>

    <!-- ==================== ADMIN PAGE ==================== -->
    <main v-else class="admin-shell">
      <aside class="admin-sidebar">
        <div class="admin-sidebar-brand">
          <strong>XDUCraft Survey</strong>
          <span>管理后台</span>
        </div>
        <nav>
          <button
            v-for="panel in adminPanels"
            :key="panel.key"
            class="admin-nav-btn"
            :class="{ active: adminPanel === panel.key }"
            @click="navigateAdmin(panel.key)"
          >
            {{ panel.label }}
            <span v-if="panel.key === 'candidates' && pendingCandidateCount" class="admin-nav-badge">{{ pendingCandidateCount }}</span>
          </button>
        </nav>
        <div class="admin-sidebar-footer">
          <n-button block quaternary size="small" @click="openPublicSurvey()" style="color: #94a3b8">
            新窗口打开问卷
          </n-button>
        </div>
      </aside>

      <section class="admin-main">
        <n-alert v-if="apiError" type="error" :bordered="false" style="margin-bottom: 16px">
          API 连接失败：{{ apiError }}
        </n-alert>
        <n-alert v-else-if="apiLoading" type="info" :bordered="false" style="margin-bottom: 16px">
          正在同步后台数据...
        </n-alert>
        <!-- Admin login -->
        <div v-if="!isAdmin" class="admin-content" style="max-width: 440px">
          <n-card title="管理员登录">
            <p style="color: #64748b; margin: 0 0 20px">当前为 mock OAuth 身份。正式版本会替换为 Blessing Skin OAuth2。</p>
            <n-form label-placement="top" :show-feedback="false">
              <n-form-item label="显示名">
                <n-input v-model:value="loginDraft.displayName" />
              </n-form-item>
              <n-form-item label="游戏 ID">
                <n-input v-model:value="loginDraft.gameId" />
              </n-form-item>
              <n-button type="primary" block @click="loginAs('admin')" style="margin-top: 8px">进入后台</n-button>
            </n-form>
          </n-card>
        </div>

        <div v-else class="admin-content">
          <!-- ====== Surveys panel ====== -->
          <template v-if="adminPanel === 'surveys'">
            <div class="admin-section-header">
              <div>
                <h1>问卷管理</h1>
                <p>创建问卷、配置投票规则，并发布独立链接或二维码。</p>
              </div>
              <n-button @click="resetDemo">重置演示数据</n-button>
            </div>

            <div class="admin-two-col">
              <n-card title="新建问卷" size="small">
                <n-form label-placement="top" :show-feedback="false">
                  <n-form-item label="标题">
                    <n-input v-model:value="surveyDraft.title" placeholder="例如 夏季服务器方案投票" />
                  </n-form-item>
                  <n-form-item label="说明">
                    <n-input v-model:value="surveyDraft.description" type="textarea" :rows="2" placeholder="请选择你愿意参与的服务器方案。" />
                  </n-form-item>
                  <n-form-item label="答题指引">
                    <n-input v-model:value="surveyDraft.guideText" type="textarea" :rows="2" />
                  </n-form-item>
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
                    <n-form-item label="模式">
                      <n-select v-model:value="surveyDraft.voteMode" :options="voteModeOptions" />
                    </n-form-item>
                    <n-form-item label="最多项数">
                      <n-input-number v-model:value="surveyDraft.maxVotes" :min="1" style="width: 100%" />
                    </n-form-item>
                  </div>
                  <n-form-item label="票数显示">
                    <n-select v-model:value="surveyDraft.resultVisibility" :options="resultVisibilityOptions" />
                  </n-form-item>
                  <n-space vertical :size="10" style="margin: 4px 0 16px">
                    <n-space align="center" :size="8"><n-switch v-model:value="surveyDraft.requireLogin" size="small" /><span>强制要求登录</span></n-space>
                    <n-space align="center" :size="8"><n-switch v-model:value="surveyDraft.allowVoteEdits" size="small" /><span>允许投票后修改</span></n-space>
                    <n-space align="center" :size="8"><n-switch v-model:value="surveyDraft.candidateSubmissionEnabled" size="small" /><span>开放自定义候选项</span></n-space>
                    <n-space align="center" :size="8"><n-switch v-model:value="surveyDraft.candidateSubmissionRequiresReview" size="small" /><span>候选项需要审核</span></n-space>
                  </n-space>
                  <n-button type="primary" block @click="createSurvey">创建并配置字段</n-button>
                </n-form>
              </n-card>

              <n-card title="当前问卷" size="small">
                <n-form label-placement="top" :show-feedback="false">
                  <n-form-item label="选择问卷">
                    <n-select v-model:value="adminSurveyId" :options="surveySelectOptions" />
                  </n-form-item>
                  <n-form-item label="标题">
                    <n-input v-model:value="surveySettingsDraft.title" />
                  </n-form-item>
                  <n-form-item label="状态">
                    <n-select v-model:value="surveySettingsDraft.status" :options="statusOptions" />
                  </n-form-item>
                  <n-form-item label="说明">
                    <n-input v-model:value="surveySettingsDraft.description" type="textarea" :rows="2" />
                  </n-form-item>
                  <n-form-item label="答题指引">
                    <n-input v-model:value="surveySettingsDraft.guideText" type="textarea" :rows="2" />
                  </n-form-item>
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
                    <n-form-item label="模式">
                      <n-select v-model:value="surveySettingsDraft.voteMode" :options="voteModeOptions" />
                    </n-form-item>
                    <n-form-item label="最多项数">
                      <n-input-number v-model:value="surveySettingsDraft.maxVotes" :min="1" style="width: 100%" />
                    </n-form-item>
                  </div>
                  <n-form-item label="票数显示">
                    <n-select v-model:value="surveySettingsDraft.resultVisibility" :options="resultVisibilityOptions" />
                  </n-form-item>
                  <n-space vertical :size="10" style="margin: 4px 0 16px">
                    <n-space align="center" :size="8"><n-switch v-model:value="surveySettingsDraft.requireLogin" size="small" /><span>强制要求登录</span></n-space>
                    <n-space align="center" :size="8"><n-switch v-model:value="surveySettingsDraft.allowVoteEdits" size="small" /><span>允许投票后修改</span></n-space>
                    <n-space align="center" :size="8"><n-switch v-model:value="surveySettingsDraft.candidateSubmissionEnabled" size="small" /><span>开放自定义候选项</span></n-space>
                    <n-space align="center" :size="8"><n-switch v-model:value="surveySettingsDraft.candidateSubmissionRequiresReview" size="small" /><span>候选项需要审核</span></n-space>
                  </n-space>

                  <n-alert v-if="surveyHasVotes" type="info" :bordered="false" style="margin-bottom: 16px">
                    该问卷已有 {{ surveyVotes.length }} 条投票。修改规则会影响之后的提交。
                  </n-alert>

                  <n-space justify="space-between" align="center" style="margin-bottom: 16px">
                    <n-tag :type="surveySettingsDirty ? 'warning' : 'success'" :bordered="false">
                      {{ surveySettingsDirty ? '有未保存设置' : '设置已保存' }}
                    </n-tag>
                    <n-space :size="8">
                      <n-button @click="navigateAdmin('fields')">配置字段</n-button>
                      <n-button @click="openPreview">发布预览</n-button>
                      <n-button type="primary" :disabled="!surveySettingsDirty" @click="saveSurveySettings()">保存设置</n-button>
                    </n-space>
                  </n-space>

                  <div class="share-section">
                    <strong>发布链接</strong>
                    <code>{{ publicSurveyUrl }}</code>
                    <n-button size="small" @click="copyPublicLink">复制链接</n-button>
                    <img :src="publicSurveyQrUrl" alt="问卷二维码" />
                  </div>
                </n-form>
              </n-card>
            </div>
          </template>

          <!-- ====== Preview panel ====== -->
          <template v-if="adminPanel === 'preview'">
            <div class="admin-section-header">
              <div>
                <h1>发布预览</h1>
                <p>预览玩家通过公开链接打开时看到的答题页。</p>
              </div>
              <n-space :size="8">
                <n-button v-if="survey.status !== 'open'" @click="publishSurvey">发布问卷</n-button>
                <n-button type="primary" @click="openPublicSurvey(activeSurveyId)">新窗口打开公开链接</n-button>
              </n-space>
            </div>

            <div class="preview-frame">
              <div class="survey-container">
                <n-card>
                  <template #header>
                    <n-space align="center" :size="12">
                      <span style="font-size: 20px; font-weight: 700">{{ survey.title }}</span>
                      <n-tag :type="statusTagType(survey.status)" size="small" round>{{ statusLabel(survey.status) }}</n-tag>
                    </n-space>
                  </template>
                  <p style="color: #64748b; margin: 0 0 16px; line-height: 1.6">{{ surveyGuideText }}</p>
                  <n-space vertical :size="8">
                    <div v-for="c in approvedCandidates" :key="c.id" class="candidate-card" style="cursor: default">
                      <div class="candidate-card-check"></div>
                      <div class="candidate-card-body">
                        <div class="candidate-card-title">{{ c.title }}</div>
                        <div class="candidate-card-meta">{{ candidateMeta(c) || '未填写补充信息' }}</div>
                        <div v-if="canViewResultsBeforeVote" class="candidate-card-stats">
                          <n-progress :percentage="percentForCandidate(c.id)" :show-indicator="false" :height="5" :color="'#6366f1'" :rail-color="'#e2e8f0'" />
                        </div>
                      </div>
                      <div v-if="canViewResultsBeforeVote" class="candidate-card-count">
                        <strong>{{ countForCandidate(c.id) }}</strong>
                        <span>票</span>
                      </div>
                    </div>
                    <div class="candidate-card custom-card" style="cursor: default">
                      <div class="candidate-card-check candidate-card-plus"></div>
                      <div class="candidate-card-body">
                        <div class="candidate-card-title">自定义候选项</div>
                        <div class="candidate-card-meta">新增候选项会进入审核，通过后可被投票</div>
                      </div>
                    </div>
                  </n-space>
                  <div class="submit-footer">
                    <n-tag :bordered="false" round>已选 0 / {{ voteLimit }}</n-tag>
                    <n-button type="primary" disabled>提交投票</n-button>
                  </div>
                </n-card>
              </div>
            </div>
          </template>

          <!-- ====== Fields panel ====== -->
          <template v-if="adminPanel === 'fields'">
            <div class="admin-section-header">
              <div>
                <h1>字段配置</h1>
                <p>管理当前问卷的候选项投稿字段，可拖拽排序。</p>
              </div>
              <n-space align="center" :size="8">
                <n-tag :type="fieldsDirty ? 'warning' : 'success'" :bordered="false">
                  {{ fieldsDirty ? '有未保存字段' : '字段已保存' }}
                </n-tag>
                <n-select v-model:value="adminSurveyId" :options="surveySelectOptions" style="width: 240px" />
                <n-button type="primary" :disabled="!fieldsDirty" @click="saveFieldDrafts()">保存字段</n-button>
                <n-button @click="openPreview">发布预览</n-button>
              </n-space>
            </div>

            <n-alert v-if="surveyHasCandidates" type="warning" :bordered="false" style="margin-bottom: 16px">
              当前问卷已有候选项。修改字段 Key 后，旧候选项中对应字段可能不再显示。
            </n-alert>

            <n-space vertical :size="12">
              <div
                v-for="(field, index) in fieldDrafts"
                :key="field.id"
                class="field-row"
                draggable="true"
                @dragstart="draggedFieldId = field.id"
                @dragover.prevent
                @drop="dropFieldBefore(field.id)"
                style="cursor: grab"
              >
                <n-form-item label="名称" :show-feedback="false">
                  <n-input v-model:value="field.label" />
                </n-form-item>
                <n-form-item label="Key" :show-feedback="false">
                  <n-input v-model:value="field.key" />
                </n-form-item>
                <n-form-item label="类型" :show-feedback="false">
                  <n-select v-model:value="field.type" :options="fieldTypeOptions" />
                </n-form-item>
                <n-form-item label="占位文本" :show-feedback="false">
                  <n-input v-model:value="field.placeholder" />
                </n-form-item>
                <div class="field-row-full" style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
                  <n-space align="center" :size="12">
                    <n-space align="center" :size="6"><n-switch v-model:value="field.required" size="small" /><span style="font-size: 13px">必填</span></n-space>
                    <n-button size="tiny" :disabled="index === 0" @click="moveField(field.id, -1)">上移</n-button>
                    <n-button size="tiny" :disabled="index === fieldDrafts.length - 1" @click="moveField(field.id, 1)">下移</n-button>
                  </n-space>
                  <n-button size="small" type="error" @click="removeField(field)">移除</n-button>
                </div>
                <n-form-item label="选项（每行一个）" :show-feedback="false" class="field-row-full">
                  <n-input type="textarea" :value="fieldOptions(field).join('\n')" :rows="2" @blur="(e: FocusEvent) => updateFieldOptions(field, (e.target as HTMLTextAreaElement).value)" />
                </n-form-item>
              </div>

              <n-card title="添加新字段" size="small" style="border-style: dashed">
                <div class="field-row" style="border: none; padding: 0">
                  <n-form-item label="名称" :show-feedback="false">
                    <n-input v-model:value="newField.label" />
                  </n-form-item>
                  <n-form-item label="Key（可留空）" :show-feedback="false">
                    <n-input v-model:value="newField.key" />
                  </n-form-item>
                  <n-form-item label="类型" :show-feedback="false">
                    <n-select v-model:value="newField.type" :options="fieldTypeOptions" />
                  </n-form-item>
                  <n-form-item label="占位文本" :show-feedback="false">
                    <n-input v-model:value="newField.placeholder" />
                  </n-form-item>
                  <div class="field-row-full">
                    <n-space align="center" :size="6"><n-switch v-model:value="newField.required" size="small" /><span style="font-size: 13px">必填</span></n-space>
                  </div>
                  <n-form-item label="选项（每行一个）" :show-feedback="false" class="field-row-full">
                    <n-input v-model:value="newField.optionsText" type="textarea" :rows="2" />
                  </n-form-item>
                </div>
                <n-button type="primary" block style="margin-top: 12px" @click="addField">添加字段</n-button>
              </n-card>
            </n-space>
          </template>

          <!-- ====== Candidates panel ====== -->
          <template v-if="adminPanel === 'candidates'">
            <div class="admin-section-header">
              <div>
                <h1>候选审核</h1>
                <p>处理所有问卷里的玩家投稿，不受当前问卷选择影响。</p>
              </div>
              <n-space :size="8">
                <n-button :type="candidateFilter === 'pending' ? 'primary' : 'default'" size="small" @click="candidateFilter = 'pending'">待审核</n-button>
                <n-button :type="candidateFilter === 'approved' ? 'primary' : 'default'" size="small" @click="candidateFilter = 'approved'">已通过</n-button>
                <n-button :type="candidateFilter === 'rejected' ? 'primary' : 'default'" size="small" @click="candidateFilter = 'rejected'">已拒绝</n-button>
                <n-button :type="candidateFilter === 'all' ? 'primary' : 'default'" size="small" @click="candidateFilter = 'all'">全部</n-button>
              </n-space>
            </div>

            <n-empty v-if="adminCandidateRows.length === 0" description="当前筛选下没有候选项" />
            <n-space v-else vertical :size="12">
              <div v-for="c in adminCandidateRows" :key="c.id" class="review-card">
                <div class="review-card-header">
                  <n-space align="center" :size="8">
                    <strong style="font-size: 16px">{{ c.title }}</strong>
                    <n-tag type="info" size="small" :bordered="false">{{ surveyTitleById(c.surveyId) }}</n-tag>
                    <n-tag :type="statusTagType(c.status)" size="small" round>{{ statusLabel(c.status) }}</n-tag>
                  </n-space>
                  <span style="color: #94a3b8; font-size: 13px">{{ c.submitterName }} / {{ formatDate(c.createdAt) }}</span>
                </div>
                <div class="review-card-fields">
                  <dl v-for="field in candidateReviewFields(c)" :key="field.key" class="review-card-field">
                    <dt>{{ field.label }}</dt>
                    <dd>{{ field.value || '未填' }}</dd>
                  </dl>
                </div>
                <n-form-item label="审核备注" :show-feedback="false" style="margin-bottom: 12px">
                  <n-input v-model:value="reviewNotes[c.id]" type="textarea" :rows="2" :placeholder="c.reviewNote || '审核备注'" />
                </n-form-item>
                <n-space :size="8">
                  <n-button v-if="c.status !== 'approved'" type="primary" size="small" @click="setCandidateStatus(c, 'approved')">通过</n-button>
                  <n-button v-if="c.status !== 'pending'" size="small" @click="setCandidateStatus(c, 'pending')">退回待审</n-button>
                  <n-button v-if="c.status !== 'rejected'" type="error" size="small" @click="setCandidateStatus(c, 'rejected')">拒绝</n-button>
                </n-space>
              </div>
            </n-space>
          </template>

          <!-- ====== Archive panel ====== -->
          <template v-if="adminPanel === 'archive'">
            <div class="admin-section-header">
              <div>
                <h1>数据留档</h1>
                <p>导出当前问卷的候选项、投票记录和完整 JSON。</p>
              </div>
              <n-space :size="8">
                <n-button size="small" @click="exportResultsCsv">候选 CSV</n-button>
                <n-button size="small" @click="exportVotesCsv">投票 CSV</n-button>
                <n-button size="small" @click="exportJson">JSON</n-button>
              </n-space>
            </div>

            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px">
              <n-card size="small">
                <n-statistic label="参与人数" :value="totalVoters" />
              </n-card>
              <n-card size="small">
                <n-statistic label="总选择数" :value="totalSelections" />
              </n-card>
              <n-card size="small">
                <n-statistic label="候选项数" :value="approvedCandidates.length" />
              </n-card>
            </div>

            <div class="archive-grid">
              <n-card title="投票记录" size="small">
                <n-empty v-if="surveyVotes.length === 0" description="暂无投票记录" />
                <n-space v-else vertical :size="6">
                  <div v-for="v in surveyVotes" :key="v.id" class="archive-item">
                    <strong>{{ v.userName }}</strong>
                    <span>{{ v.candidateIds.length }} 项 / {{ formatDate(v.updatedAt) }}</span>
                  </div>
                </n-space>
              </n-card>
              <n-card title="操作日志" size="small">
                <n-empty v-if="appState.auditLogs.length === 0" description="暂无日志" />
                <n-space v-else vertical :size="6">
                  <div v-for="log in appState.auditLogs.slice(0, 15)" :key="log.id" class="archive-item">
                    <strong style="font-size: 13px">{{ log.action }}</strong>
                    <span>{{ log.detail }}</span>
                  </div>
                </n-space>
              </n-card>
            </div>

            <n-alert v-if="latestVote" type="info" :bordered="false" style="margin-top: 16px">
              最近投票更新：{{ latestVote.userName }} / {{ formatDate(latestVote.updatedAt) }}
            </n-alert>
          </template>
        </div>
      </section>
    </main>
  </n-config-provider>
</template>
