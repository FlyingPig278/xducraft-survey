<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { createId, createSeedState, loadState, loadUser, saveState, saveUser } from './storage'
import type {
  AppState,
  AuditLog,
  Candidate,
  CandidateStatus,
  FieldDefinition,
  FieldType,
  MockUser,
  SurveyDefinition,
  SurveyStatus,
  UserRole,
  VoteMode,
  VoteRecord
} from './types'

type AdminPanelKey = 'surveys' | 'fields' | 'candidates' | 'archive'
type CandidateFilter = CandidateStatus | 'all'
type RouteState = { mode: 'survey'; surveyId: string } | { mode: 'admin'; panel: AdminPanelKey }

interface ResultRow {
  candidate: Candidate
  count: number
  percent: number
}

const appState = ref<AppState>(loadState())
const currentUser = ref<MockUser | null>(loadUser())
const hash = ref(window.location.hash)
const adminSurveyId = ref(appState.value.surveys[0]?.id ?? '')
const selectedCandidateIds = ref<string[]>([])
const statusMessage = ref('')
const submissionMessage = ref('')
const adminMessage = ref('')
const reviewNotes = ref<Record<string, string>>({})
const submissionValues = ref<Record<string, string>>({})
const voteConfirmOpen = ref(false)
const candidateModalOpen = ref(false)
const submittedSurveyId = ref('')
const candidateFilter = ref<CandidateFilter>('pending')

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
  voteMode: 'multiple' as VoteMode,
  maxVotes: 3,
  publicResults: true,
  allowVoteEdits: false,
  candidateSubmissionEnabled: true,
  candidateSubmissionRequiresReview: true,
  cloneCurrentFields: true
})

const defaultCandidateFieldTemplates: Array<Omit<FieldDefinition, 'id'>> = [
  {
    key: 'packName',
    label: '整合包名',
    type: 'text',
    required: true,
    placeholder: '例如 All the Mods 10'
  },
  {
    key: 'modloader',
    label: 'ModLoader',
    type: 'select',
    required: true,
    placeholder: '',
    options: ['Fabric', 'Forge', 'NeoForge', 'Quilt', 'Vanilla/DataPack']
  },
  {
    key: 'gameVersion',
    label: '游戏版本',
    type: 'text',
    required: true,
    placeholder: '例如 1.20.1'
  },
  {
    key: 'category',
    label: '大致分类',
    type: 'select',
    required: true,
    placeholder: '',
    options: ['科技', '魔法', '冒险探索', '养老建筑', '专家包', '轻量休闲', '大型综合']
  },
  {
    key: 'packUrl',
    label: '整合包链接',
    type: 'url',
    required: true,
    placeholder: 'CurseForge / Modrinth / 官网链接'
  },
  {
    key: 'videoUrl',
    label: '宣传视频',
    type: 'url',
    required: false,
    placeholder: 'Bilibili / YouTube 链接'
  },
  {
    key: 'notes',
    label: '推荐理由',
    type: 'textarea',
    required: false,
    placeholder: '为什么推荐它作为服务器方案'
  }
]

const adminPanels: Array<{ key: AdminPanelKey; label: string }> = [
  { key: 'surveys', label: '问卷' },
  { key: 'fields', label: '字段' },
  { key: 'candidates', label: '审核' },
  { key: 'archive', label: '留档' }
]

const parseHash = (value: string): RouteState => {
  const clean = value.replace(/^#\/?/, '')
  const segments = clean.split('/').filter(Boolean)
  if (segments[0] === 'admin') {
    const panel = adminPanels.some((item) => item.key === segments[1])
      ? (segments[1] as AdminPanelKey)
      : 'surveys'
    return { mode: 'admin', panel }
  }
  if (segments[0] === 's' && segments[1]) return { mode: 'survey', surveyId: segments[1] }
  return { mode: 'survey', surveyId: appState.value.surveys[0]?.id ?? '' }
}

const route = computed(() => parseHash(hash.value))
const surveys = computed(() =>
  [...appState.value.surveys].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
)
const activeSurveyId = computed(() =>
  route.value.mode === 'survey' ? route.value.surveyId : adminSurveyId.value
)
const survey = computed<SurveyDefinition>(() => {
  const selected = appState.value.surveys.find((item) => item.id === activeSurveyId.value)
  return selected ?? appState.value.surveys[0]!
})
const adminPanel = computed(() => (route.value.mode === 'admin' ? route.value.panel : 'surveys'))
const isAdminRoute = computed(() => route.value.mode === 'admin')
const isAdmin = computed(() => currentUser.value?.role === 'admin')

const surveyCandidates = computed(() =>
  appState.value.candidates.filter((candidate) => candidate.surveyId === survey.value.id)
)
const surveyVotes = computed(() => appState.value.votes.filter((vote) => vote.surveyId === survey.value.id))
const approvedCandidates = computed(() =>
  surveyCandidates.value.filter((candidate) => candidate.status === 'approved')
)
const pendingCandidates = computed(() =>
  surveyCandidates.value.filter((candidate) => candidate.status === 'pending')
)
const rejectedCandidates = computed(() =>
  surveyCandidates.value.filter((candidate) => candidate.status === 'rejected')
)
const pendingCandidateCount = computed(
  () => appState.value.candidates.filter((candidate) => candidate.status === 'pending').length
)
const voteLimit = computed(() => (survey.value.voteMode === 'single' ? 1 : Math.max(1, survey.value.maxVotes || 1)))
const currentVote = computed(() => {
  if (!currentUser.value) return null
  return surveyVotes.value.find((vote) => vote.userId === currentUser.value?.id) ?? null
})
const approvedCandidateIds = computed(() => new Set(approvedCandidates.value.map((candidate) => candidate.id)))
const selectedCandidates = computed(() =>
  selectedCandidateIds.value
    .map((candidateId) => approvedCandidates.value.find((candidate) => candidate.id === candidateId))
    .filter((candidate): candidate is Candidate => Boolean(candidate))
)
const totalVoters = computed(() => surveyVotes.value.length)
const totalSelections = computed(() =>
  surveyVotes.value.reduce((total, vote) => total + vote.candidateIds.length, 0)
)
const candidateCounts = computed(() => {
  const counts = new Map<string, number>()
  surveyVotes.value.forEach((vote) => {
    vote.candidateIds.forEach((candidateId) => {
      counts.set(candidateId, (counts.get(candidateId) ?? 0) + 1)
    })
  })
  return counts
})
const resultRows = computed<ResultRow[]>(() =>
  approvedCandidates.value
    .map((candidate) => {
      const count = candidateCounts.value.get(candidate.id) ?? 0
      const percent = totalVoters.value > 0 ? Math.round((count / totalVoters.value) * 100) : 0
      return { candidate, count, percent }
    })
    .sort((left, right) => right.count - left.count || left.candidate.title.localeCompare(right.candidate.title))
)
const showResults = computed(() => Boolean(currentVote.value) || submittedSurveyId.value === survey.value.id)
const latestVote = computed(() =>
  [...surveyVotes.value].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
)
const adminCandidateRows = computed(() => {
  const rows =
    candidateFilter.value === 'all'
      ? surveyCandidates.value
      : surveyCandidates.value.filter((candidate) => candidate.status === candidateFilter.value)
  return [...rows].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
})
const publicSurveyUrl = computed(() => `${window.location.origin}${window.location.pathname}#/s/${survey.value.id}`)
const publicSurveyQrUrl = computed(
  () => `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(publicSurveyUrl.value)}`
)

const navigateSurvey = (surveyId: string) => {
  window.location.hash = `#/s/${surveyId}`
}

const navigateAdmin = (panel: AdminPanelKey) => {
  window.location.hash = `#/admin/${panel}`
}

const persist = () => {
  saveState(appState.value)
}

const touchSurvey = () => {
  survey.value.maxVotes = Math.max(1, Number(survey.value.maxVotes) || 1)
  survey.value.updatedAt = new Date().toISOString()
  persist()
}

const addAudit = (action: string, detail: string, actor = currentUser.value?.displayName ?? 'System') => {
  const log: AuditLog = {
    id: createId('log'),
    action,
    actor,
    detail,
    createdAt: new Date().toISOString()
  }
  appState.value.auditLogs.unshift(log)
  persist()
}

const formatDate = (value?: string) => {
  if (!value) return '未记录'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')

const statusLabel = (status: SurveyStatus | CandidateStatus) => {
  const labels: Record<string, string> = {
    draft: '草稿',
    open: '开放',
    closed: '已关闭',
    pending: '待审核',
    approved: '已通过',
    rejected: '已拒绝'
  }
  return labels[status] ?? status
}

const voteModeLabel = (mode: VoteMode) => (mode === 'single' ? '单选' : `最多 ${voteLimit.value} 项`)

const buildKey = (label: string, fallbackIndex = survey.value.candidateFields.length + 1) => {
  const key = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return key || `custom_field_${fallbackIndex}`
}

const fieldOptions = (field: FieldDefinition) => field.options?.filter(Boolean) ?? []

const validateUrl = (value: string) => {
  if (!value.trim()) return true
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

const candidateTitleById = (candidateId: string) =>
  approvedCandidates.value.find((candidate) => candidate.id === candidateId)?.title ?? '未知候选项'

const candidateMeta = (candidate: Candidate) =>
  survey.value.candidateFields
    .filter((field) => field.key !== 'packName' && field.type !== 'textarea' && field.type !== 'url')
    .slice(0, 3)
    .map((field) => candidate.fields[field.key])
    .filter(Boolean)
    .join(' / ')

const initSubmissionValues = () => {
  const nextValues: Record<string, string> = {}
  survey.value.candidateFields.forEach((field) => {
    nextValues[field.key] = submissionValues.value[field.key] ?? ''
  })
  submissionValues.value = nextValues
}

const resetSubmissionValues = () => {
  const nextValues: Record<string, string> = {}
  survey.value.candidateFields.forEach((field) => {
    nextValues[field.key] = ''
  })
  submissionValues.value = nextValues
}

const syncSelectionFromVote = () => {
  selectedCandidateIds.value = currentVote.value
    ? currentVote.value.candidateIds.filter((candidateId) => approvedCandidateIds.value.has(candidateId))
    : []
}

const handleHashChange = () => {
  hash.value = window.location.hash
}

onMounted(() => {
  window.addEventListener('hashchange', handleHashChange)
  if (!window.location.hash) navigateSurvey(appState.value.surveys[0]?.id ?? '')
})

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', handleHashChange)
})

watch(
  () => appState.value.surveys.map((item) => item.id).join('|'),
  () => {
    if (!appState.value.surveys.some((item) => item.id === adminSurveyId.value)) {
      adminSurveyId.value = appState.value.surveys[0]?.id ?? ''
    }
    if (route.value.mode === 'survey' && !appState.value.surveys.some((item) => item.id === activeSurveyId.value)) {
      navigateSurvey(appState.value.surveys[0]?.id ?? '')
    }
  },
  { immediate: true }
)
watch(
  () => survey.value.id,
  () => {
    initSubmissionValues()
    syncSelectionFromVote()
    statusMessage.value = ''
    submissionMessage.value = ''
    voteConfirmOpen.value = false
    candidateModalOpen.value = false
  },
  { immediate: true }
)
watch(currentUser, syncSelectionFromVote, { immediate: true })
watch(
  () => `${survey.value.id}:${survey.value.candidateFields.map((field) => `${field.id}:${field.key}`).join('|')}`,
  initSubmissionValues,
  { immediate: true }
)
watch(
  () => `${survey.value.id}:${surveyVotes.value.map((vote) => `${vote.userId}:${vote.updatedAt}`).join('|')}`,
  syncSelectionFromVote
)
watch(
  () => approvedCandidates.value.map((candidate) => candidate.id).join('|'),
  () => {
    selectedCandidateIds.value = selectedCandidateIds.value.filter((candidateId) =>
      approvedCandidateIds.value.has(candidateId)
    )
  }
)

const loginAs = (role: UserRole) => {
  const displayName = loginDraft.displayName.trim() || loginDraft.gameId.trim() || 'Player'
  const gameId = loginDraft.gameId.trim() || displayName
  const normalizedId = normalize(gameId).replace(/[^a-z0-9_:-]/g, '-') || createId('user')
  currentUser.value = {
    id: role === 'admin' ? 'mock-admin' : `mock-${normalizedId}`,
    displayName: role === 'admin' ? `${displayName} 管理员` : displayName,
    gameId,
    role
  }
  saveUser(currentUser.value)
  statusMessage.value = role === 'admin' ? '已切换为管理员 mock 身份。' : '已登录。'
  syncSelectionFromVote()
}

const logout = () => {
  currentUser.value = null
  saveUser(null)
  statusMessage.value = '已退出登录。'
}

const isSelected = (candidateId: string) => selectedCandidateIds.value.includes(candidateId)

const toggleCandidate = (candidateId: string) => {
  statusMessage.value = ''
  if (showResults.value && !survey.value.allowVoteEdits) return
  if (survey.value.status !== 'open') {
    statusMessage.value = '当前问卷不在开放投票状态。'
    return
  }
  if (!approvedCandidateIds.value.has(candidateId)) return

  if (survey.value.voteMode === 'single') {
    selectedCandidateIds.value = isSelected(candidateId) ? [] : [candidateId]
    return
  }

  if (isSelected(candidateId)) {
    selectedCandidateIds.value = selectedCandidateIds.value.filter((id) => id !== candidateId)
    return
  }

  if (selectedCandidateIds.value.length >= voteLimit.value) {
    statusMessage.value = `最多选择 ${voteLimit.value} 项。`
    return
  }

  selectedCandidateIds.value = [...selectedCandidateIds.value, candidateId]
}

const openVoteConfirm = () => {
  statusMessage.value = ''
  if (!currentUser.value) {
    statusMessage.value = '请先登录后提交投票。'
    return
  }
  if (survey.value.status !== 'open') {
    statusMessage.value = '当前问卷不在开放投票状态。'
    return
  }
  if (currentVote.value && !survey.value.allowVoteEdits) {
    statusMessage.value = '你已经提交过本问卷，当前不允许修改。'
    return
  }
  if (selectedCandidateIds.value.length === 0) {
    statusMessage.value = '请至少选择一个候选项。'
    return
  }
  voteConfirmOpen.value = true
}

const confirmSubmitVote = () => {
  if (!currentUser.value) return
  const validSelection = selectedCandidateIds.value.filter((candidateId) =>
    approvedCandidateIds.value.has(candidateId)
  )
  selectedCandidateIds.value = [...new Set(validSelection)]
  if (selectedCandidateIds.value.length === 0 || selectedCandidateIds.value.length > voteLimit.value) return

  const timestamp = new Date().toISOString()
  if (currentVote.value) {
    currentVote.value.history.push({
      candidateIds: [...currentVote.value.candidateIds],
      changedAt: currentVote.value.updatedAt
    })
    currentVote.value.candidateIds = [...selectedCandidateIds.value]
    currentVote.value.updatedAt = timestamp
    addAudit('vote.updated', `${currentUser.value.displayName} 修改了「${survey.value.title}」的投票`)
  } else {
    const vote: VoteRecord = {
      id: createId('vote'),
      surveyId: survey.value.id,
      userId: currentUser.value.id,
      userName: currentUser.value.displayName,
      gameId: currentUser.value.gameId,
      candidateIds: [...selectedCandidateIds.value],
      createdAt: timestamp,
      updatedAt: timestamp,
      history: []
    }
    appState.value.votes.push(vote)
    addAudit('vote.created', `${currentUser.value.displayName} 提交了「${survey.value.title}」的投票`)
  }

  voteConfirmOpen.value = false
  submittedSurveyId.value = survey.value.id
  statusMessage.value = '提交成功，下面是匿名统计结果。'
}

const submitCandidate = () => {
  submissionMessage.value = ''
  if (!currentUser.value) {
    submissionMessage.value = '请先登录后提交候选项。'
    return
  }
  if (survey.value.status !== 'open' || !survey.value.candidateSubmission.enabled) {
    submissionMessage.value = '当前问卷没有开放候选项投稿。'
    return
  }

  for (const field of survey.value.candidateFields) {
    const value = submissionValues.value[field.key]?.trim() ?? ''
    if (field.required && !value) {
      submissionMessage.value = `请填写「${field.label}」。`
      return
    }
    if (field.type === 'url' && !validateUrl(value)) {
      submissionMessage.value = `「${field.label}」需要是完整链接。`
      return
    }
  }

  const title =
    submissionValues.value.packName?.trim() ||
    submissionValues.value.name?.trim() ||
    submissionValues.value.title?.trim() ||
    survey.value.candidateFields.map((field) => submissionValues.value[field.key]).find(Boolean)?.trim() ||
    '未命名候选项'

  const duplicate = appState.value.candidates.find(
    (candidate) =>
      candidate.surveyId === survey.value.id &&
      candidate.status !== 'rejected' &&
      normalize(candidate.title) === normalize(title)
  )
  if (duplicate) {
    submissionMessage.value = '已经存在同名候选项，请等待审核或给已有候选项投票。'
    return
  }

  const timestamp = new Date().toISOString()
  const status: CandidateStatus = survey.value.candidateSubmission.requiresReview ? 'pending' : 'approved'
  const candidate: Candidate = {
    id: createId('candidate'),
    surveyId: survey.value.id,
    title,
    status,
    fields: { ...submissionValues.value },
    submitterUserId: currentUser.value.id,
    submitterName: currentUser.value.displayName,
    createdAt: timestamp,
    reviewedAt: status === 'approved' ? timestamp : undefined,
    reviewerName: status === 'approved' ? 'Auto Review' : undefined
  }
  appState.value.candidates.unshift(candidate)
  addAudit('candidate.submitted', `${currentUser.value.displayName} 投稿了「${title}」`)
  resetSubmissionValues()
  submissionMessage.value = status === 'pending' ? '候选项已提交，等待管理员审核。' : '候选项已进入投票列表。'
}

const setCandidateStatus = (candidate: Candidate, status: CandidateStatus) => {
  if (!isAdmin.value || !currentUser.value) {
    adminMessage.value = '请先使用 mock 管理员身份登录。'
    return
  }

  candidate.status = status
  candidate.reviewedAt = new Date().toISOString()
  candidate.reviewerName = currentUser.value.displayName
  candidate.reviewNote = reviewNotes.value[candidate.id] ?? candidate.reviewNote ?? ''
  addAudit(`candidate.${status}`, `${currentUser.value.displayName} 将「${candidate.title}」标记为${statusLabel(status)}`)
  adminMessage.value = `「${candidate.title}」已标记为${statusLabel(status)}。`
}

const cloneField = (field: FieldDefinition): FieldDefinition => ({
  ...field,
  id: createId('field'),
  options: field.options ? [...field.options] : undefined
})

const createDefaultCandidateFields = (): FieldDefinition[] =>
  defaultCandidateFieldTemplates.map((field) => ({
    ...field,
    id: createId('field'),
    options: field.options ? [...field.options] : undefined
  }))

const addField = () => {
  adminMessage.value = ''
  const label = newField.label.trim()
  if (!label) {
    adminMessage.value = '请先填写字段名称。'
    return
  }

  const key = (newField.key.trim() || buildKey(label)).replace(/[^a-zA-Z0-9_]/g, '_')
  const exists = survey.value.candidateFields.some((field) => field.key === key)
  if (exists) {
    adminMessage.value = '字段 key 已存在，请换一个。'
    return
  }

  survey.value.candidateFields.push({
    id: createId('field'),
    key,
    label,
    type: newField.type,
    required: newField.required,
    placeholder: newField.placeholder.trim(),
    options: newField.optionsText
      .split('\n')
      .map((option) => option.trim())
      .filter(Boolean)
  })

  newField.label = ''
  newField.key = ''
  newField.type = 'text'
  newField.required = true
  newField.placeholder = ''
  newField.optionsText = ''
  touchSurvey()
  addAudit('survey.field_added', `新增「${survey.value.title}」投稿字段「${label}」`)
  adminMessage.value = '字段已添加。'
}

const removeField = (field: FieldDefinition) => {
  survey.value.candidateFields = survey.value.candidateFields.filter((item) => item.id !== field.id)
  touchSurvey()
  addAudit('survey.field_removed', `移除了「${survey.value.title}」投稿字段「${field.label}」`)
}

const updateFieldOptions = (field: FieldDefinition, value: string) => {
  field.options = value
    .split('\n')
    .map((option) => option.trim())
    .filter(Boolean)
  touchSurvey()
}

const createSurvey = () => {
  adminMessage.value = ''
  if (!isAdmin.value || !currentUser.value) {
    adminMessage.value = '请先使用 mock 管理员身份登录。'
    return
  }

  const title = surveyDraft.title.trim()
  if (!title) {
    adminMessage.value = '请填写新问卷标题。'
    return
  }

  const timestamp = new Date().toISOString()
  const fields = surveyDraft.cloneCurrentFields
    ? survey.value.candidateFields.map(cloneField)
    : createDefaultCandidateFields()
  const nextSurvey: SurveyDefinition = {
    id: createId('survey'),
    title,
    description: surveyDraft.description.trim() || '请选择你愿意参与的服务器方案。',
    status: 'draft',
    publicResults: surveyDraft.publicResults,
    allowVoteEdits: surveyDraft.allowVoteEdits,
    voteMode: surveyDraft.voteMode,
    maxVotes: Math.max(1, Number(surveyDraft.maxVotes) || 1),
    candidateSubmission: {
      enabled: surveyDraft.candidateSubmissionEnabled,
      requiresReview: surveyDraft.candidateSubmissionRequiresReview
    },
    candidateFields: fields,
    createdAt: timestamp,
    updatedAt: timestamp
  }

  appState.value.surveys.unshift(nextSurvey)
  adminSurveyId.value = nextSurvey.id
  surveyDraft.title = ''
  surveyDraft.description = ''
  addAudit('survey.created', `${currentUser.value.displayName} 创建了问卷「${nextSurvey.title}」`)
  navigateAdmin('surveys')
}

const resetDemo = () => {
  appState.value = createSeedState()
  adminSurveyId.value = appState.value.surveys[0]?.id ?? ''
  saveState(appState.value)
  navigateSurvey(appState.value.surveys[0]?.id ?? '')
  initSubmissionValues()
  syncSelectionFromVote()
  adminMessage.value = '演示数据已重置。'
}

const copyPublicLink = async () => {
  try {
    await navigator.clipboard.writeText(publicSurveyUrl.value)
    adminMessage.value = '公开链接已复制。'
  } catch {
    adminMessage.value = publicSurveyUrl.value
  }
}

const csvEscape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`

const exportResultsCsv = () => {
  const fieldHeaders = survey.value.candidateFields.map((field) => field.label)
  const headers = ['问卷', '候选项', '状态', '票数', '投稿人', '创建时间', ...fieldHeaders]
  const rows = surveyCandidates.value.map((candidate) => [
    survey.value.title,
    candidate.title,
    statusLabel(candidate.status),
    candidateCounts.value.get(candidate.id) ?? 0,
    candidate.submitterName,
    candidate.createdAt,
    ...survey.value.candidateFields.map((field) => candidate.fields[field.key] ?? '')
  ])
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n')
  downloadFile('xducraft-survey-results.csv', csv, 'text/csv;charset=utf-8')
}

const exportVotesCsv = () => {
  const headers = ['问卷', '玩家', '游戏 ID', '选择', '创建时间', '更新时间', '历史版本数']
  const rows = surveyVotes.value.map((vote) => [
    survey.value.title,
    vote.userName,
    vote.gameId,
    vote.candidateIds.map(candidateTitleById).join(' / '),
    vote.createdAt,
    vote.updatedAt,
    vote.history.length
  ])
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n')
  downloadFile('xducraft-survey-votes.csv', csv, 'text/csv;charset=utf-8')
}

const exportJson = () => {
  const archive = {
    survey: survey.value,
    candidates: surveyCandidates.value,
    votes: surveyVotes.value,
    auditLogs: appState.value.auditLogs
  }
  downloadFile('xducraft-survey-archive.json', JSON.stringify(archive, null, 2), 'application/json')
}

const downloadFile = (filename: string, content: string, type: string) => {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <main v-if="!isAdminRoute" class="survey-page">
    <section class="survey-card">
      <header class="survey-header">
        <p class="brand-line">XDUCraft Vote</p>
        <h1>{{ survey.title }}</h1>
        <p class="guide-text">
          请先确认列表中是否已有你想玩的服务器。若没有，请选择列表末尾的自定义项提交候选，审核通过后再投票。
        </p>
      </header>

      <section class="login-strip" aria-label="登录信息">
        <div v-if="currentUser" class="user-pill">
          <span>{{ currentUser.displayName }}</span>
          <small>{{ currentUser.gameId }}</small>
          <button type="button" @click="logout">退出</button>
        </div>
        <form v-else class="login-strip-form" @submit.prevent="loginAs('player')">
          <label>
            <span>显示名</span>
            <input v-model="loginDraft.displayName" type="text" />
          </label>
          <label>
            <span>游戏 ID</span>
            <input v-model="loginDraft.gameId" type="text" />
          </label>
          <button class="button-primary" type="submit">登录</button>
        </form>
      </section>

      <section v-if="showResults" class="result-view">
        <div class="success-box">
          <strong>{{ statusMessage || '已提交。' }}</strong>
          <span>{{ totalVoters }} 名玩家已参与，当前共 {{ totalSelections }} 个选择。</span>
        </div>
        <div class="result-list">
          <article v-for="row in resultRows" :key="row.candidate.id" class="result-row">
            <div class="result-row-main">
              <strong>{{ row.candidate.title }}</strong>
              <small>{{ candidateMeta(row.candidate) || '未填写补充信息' }}</small>
            </div>
            <div class="result-meter" aria-hidden="true">
              <span :style="{ width: `${row.count > 0 ? Math.max(row.percent, 4) : 0}%` }"></span>
            </div>
            <b>{{ row.count }} 票</b>
          </article>
        </div>
      </section>

      <section v-else class="choice-list" aria-label="投票候选项">
        <button
          v-for="candidate in approvedCandidates"
          :key="candidate.id"
          class="choice-row"
          :class="{ selected: isSelected(candidate.id) }"
          type="button"
          @click="toggleCandidate(candidate.id)"
        >
          <span class="choice-control">{{ isSelected(candidate.id) ? '✓' : '' }}</span>
          <span class="choice-main">
            <strong>{{ candidate.title }}</strong>
            <small>{{ candidateMeta(candidate) || '未填写补充信息' }}</small>
          </span>
        </button>

        <button class="choice-row custom-choice" type="button" @click="candidateModalOpen = true">
          <span class="choice-control">+</span>
          <span class="choice-main">
            <strong>自定义，请填写表单</strong>
            <small>新增候选项会进入审核，通过后可被投票。</small>
          </span>
        </button>
      </section>

      <footer v-if="!showResults" class="submit-bar">
        <p>{{ selectedCandidateIds.length }} / {{ voteLimit }} 已选</p>
        <button class="button-primary" type="button" @click="openVoteConfirm">提交</button>
      </footer>

      <p v-if="statusMessage && !showResults" class="inline-message">{{ statusMessage }}</p>
    </section>

    <div v-if="voteConfirmOpen" class="modal-backdrop" role="presentation">
      <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="vote-confirm-title">
        <h2 id="vote-confirm-title">确认提交投票？</h2>
        <p>提交后默认不能修改。请确认你的选择无误。</p>
        <ul class="confirm-list">
          <li v-for="candidate in selectedCandidates" :key="candidate.id">{{ candidate.title }}</li>
        </ul>
        <div class="modal-actions">
          <button class="button-ghost" type="button" @click="voteConfirmOpen = false">返回检查</button>
          <button class="button-primary" type="button" @click="confirmSubmitVote">确认提交</button>
        </div>
      </section>
    </div>

    <div v-if="candidateModalOpen" class="modal-backdrop" role="presentation">
      <section class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-labelledby="candidate-modal-title">
        <header class="modal-head">
          <div>
            <h2 id="candidate-modal-title">提交自定义候选项</h2>
            <p>审核通过后，它会出现在投票列表里。</p>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" @click="candidateModalOpen = false">×</button>
        </header>

        <form class="candidate-form" @submit.prevent="submitCandidate">
          <label
            v-for="field in survey.candidateFields"
            :key="field.id"
            :class="{ spanFull: field.type === 'textarea' }"
          >
            <span>
              {{ field.label }}
              <b v-if="field.required">*</b>
            </span>
            <select v-if="field.type === 'select'" v-model="submissionValues[field.key]">
              <option value="">请选择</option>
              <option v-for="option in fieldOptions(field)" :key="option" :value="option">{{ option }}</option>
            </select>
            <textarea
              v-else-if="field.type === 'textarea'"
              v-model="submissionValues[field.key]"
              :placeholder="field.placeholder"
              rows="4"
            ></textarea>
            <input
              v-else
              v-model="submissionValues[field.key]"
              :type="field.type === 'url' ? 'url' : field.type === 'number' ? 'number' : 'text'"
              :placeholder="field.placeholder"
            />
          </label>
          <p v-if="submissionMessage" class="inline-message spanFull">{{ submissionMessage }}</p>
          <div class="modal-actions spanFull">
            <button class="button-ghost" type="button" @click="resetSubmissionValues">重置</button>
            <button class="button-primary" type="submit">提交审核</button>
          </div>
        </form>
      </section>
    </div>
  </main>

  <main v-else class="admin-shell">
    <aside class="admin-sidebar">
      <div class="admin-brand">
        <strong>XDUCraft Survey</strong>
        <span>管理后台</span>
      </div>
      <nav aria-label="后台功能">
        <button
          v-for="panel in adminPanels"
          :key="panel.key"
          :class="{ active: adminPanel === panel.key }"
          type="button"
          @click="navigateAdmin(panel.key)"
        >
          {{ panel.label }}
          <small v-if="panel.key === 'candidates' && pendingCandidateCount">{{ pendingCandidateCount }}</small>
        </button>
      </nav>
      <button class="button-ghost" type="button" @click="navigateSurvey(survey.id)">打开当前问卷</button>
    </aside>

    <section class="admin-main">
      <div v-if="!isAdmin" class="admin-card narrow-card">
        <h1>管理员登录</h1>
        <p>当前为 mock OAuth 身份。正式版本会替换为 Blessing Skin OAuth2。</p>
        <form class="admin-login-form" @submit.prevent="loginAs('admin')">
          <label>
            <span>显示名</span>
            <input v-model="loginDraft.displayName" type="text" />
          </label>
          <label>
            <span>游戏 ID</span>
            <input v-model="loginDraft.gameId" type="text" />
          </label>
          <button class="button-primary" type="submit">进入后台</button>
        </form>
      </div>

      <template v-else>
        <section v-if="adminPanel === 'surveys'" class="admin-card">
          <header class="admin-section-head">
            <div>
              <h1>问卷</h1>
              <p>创建问卷、配置投票规则，并发布独立链接或二维码。</p>
            </div>
            <button class="button-ghost" type="button" @click="resetDemo">重置演示数据</button>
          </header>

          <div class="admin-two-col">
            <form class="admin-form" @submit.prevent="createSurvey">
              <h2>新建问卷</h2>
              <label>
                <span>标题</span>
                <input v-model="surveyDraft.title" type="text" placeholder="例如 夏季服务器方案投票" />
              </label>
              <label>
                <span>说明</span>
                <textarea v-model="surveyDraft.description" rows="3" placeholder="请选择你愿意参与的服务器方案。"></textarea>
              </label>
              <div class="form-grid">
                <label>
                  <span>模式</span>
                  <select v-model="surveyDraft.voteMode">
                    <option value="single">单选</option>
                    <option value="multiple">多选</option>
                  </select>
                </label>
                <label>
                  <span>最多项数</span>
                  <input v-model.number="surveyDraft.maxVotes" min="1" type="number" />
                </label>
              </div>
              <label class="check-line"><input v-model="surveyDraft.publicResults" type="checkbox" /> 提交后显示结果</label>
              <label class="check-line"><input v-model="surveyDraft.allowVoteEdits" type="checkbox" /> 允许投票后修改</label>
              <label class="check-line"><input v-model="surveyDraft.candidateSubmissionEnabled" type="checkbox" /> 开放自定义候选项</label>
              <label class="check-line"><input v-model="surveyDraft.candidateSubmissionRequiresReview" type="checkbox" /> 自定义候选项需要审核</label>
              <button class="button-primary" type="submit">创建问卷</button>
            </form>

            <div class="admin-form">
              <h2>当前问卷</h2>
              <label>
                <span>问卷</span>
                <select v-model="adminSurveyId">
                  <option v-for="item in surveys" :key="item.id" :value="item.id">{{ item.title }}</option>
                </select>
              </label>
              <label>
                <span>标题</span>
                <input v-model="survey.title" type="text" @change="touchSurvey" />
              </label>
              <label>
                <span>状态</span>
                <select v-model="survey.status" @change="touchSurvey">
                  <option value="draft">草稿</option>
                  <option value="open">开放</option>
                  <option value="closed">已关闭</option>
                </select>
              </label>
              <label>
                <span>说明</span>
                <textarea v-model="survey.description" rows="3" @change="touchSurvey"></textarea>
              </label>
              <div class="share-box">
                <strong>发布链接</strong>
                <code>{{ publicSurveyUrl }}</code>
                <button class="button-ghost" type="button" @click="copyPublicLink">复制链接</button>
                <img :src="publicSurveyQrUrl" alt="问卷二维码" />
              </div>
            </div>
          </div>
        </section>

        <section v-if="adminPanel === 'fields'" class="admin-card">
          <header class="admin-section-head">
            <div>
              <h1>投稿字段</h1>
              <p>配置玩家提交自定义候选项时需要填写的内容。</p>
            </div>
          </header>

          <div class="field-list">
            <article v-for="field in survey.candidateFields" :key="field.id" class="field-row">
              <label>
                <span>名称</span>
                <input v-model="field.label" type="text" @change="touchSurvey" />
              </label>
              <label>
                <span>Key</span>
                <input v-model="field.key" type="text" @change="touchSurvey" />
              </label>
              <label>
                <span>类型</span>
                <select v-model="field.type" @change="touchSurvey">
                  <option value="text">text</option>
                  <option value="textarea">textarea</option>
                  <option value="url">url</option>
                  <option value="select">select</option>
                  <option value="number">number</option>
                </select>
              </label>
              <label>
                <span>占位文本</span>
                <input v-model="field.placeholder" type="text" @change="touchSurvey" />
              </label>
              <label class="check-line"><input v-model="field.required" type="checkbox" @change="touchSurvey" /> 必填</label>
              <label class="spanFull">
                <span>选项，每行一个</span>
                <textarea
                  :value="fieldOptions(field).join('\n')"
                  rows="3"
                  @change="updateFieldOptions(field, ($event.target as HTMLTextAreaElement).value)"
                ></textarea>
              </label>
              <button class="button-danger" type="button" @click="removeField(field)">移除</button>
            </article>

            <article class="field-row add-field-row">
              <label>
                <span>新字段名称</span>
                <input v-model="newField.label" type="text" />
              </label>
              <label>
                <span>Key</span>
                <input v-model="newField.key" type="text" placeholder="可留空" />
              </label>
              <label>
                <span>类型</span>
                <select v-model="newField.type">
                  <option value="text">text</option>
                  <option value="textarea">textarea</option>
                  <option value="url">url</option>
                  <option value="select">select</option>
                  <option value="number">number</option>
                </select>
              </label>
              <label>
                <span>占位文本</span>
                <input v-model="newField.placeholder" type="text" />
              </label>
              <label class="check-line"><input v-model="newField.required" type="checkbox" /> 必填</label>
              <label class="spanFull">
                <span>选项，每行一个</span>
                <textarea v-model="newField.optionsText" rows="3"></textarea>
              </label>
              <button class="button-primary" type="button" @click="addField">添加字段</button>
            </article>
          </div>
        </section>

        <section v-if="adminPanel === 'candidates'" class="admin-card">
          <header class="admin-section-head">
            <div>
              <h1>候选审核</h1>
              <p>处理玩家提交的自定义服务器候选项。</p>
            </div>
            <div class="filter-tabs">
              <button :class="{ active: candidateFilter === 'pending' }" type="button" @click="candidateFilter = 'pending'">待审核</button>
              <button :class="{ active: candidateFilter === 'approved' }" type="button" @click="candidateFilter = 'approved'">已通过</button>
              <button :class="{ active: candidateFilter === 'rejected' }" type="button" @click="candidateFilter = 'rejected'">已拒绝</button>
              <button :class="{ active: candidateFilter === 'all' }" type="button" @click="candidateFilter = 'all'">全部</button>
            </div>
          </header>

          <div v-if="adminCandidateRows.length === 0" class="empty-state">当前筛选下没有候选项。</div>
          <div v-else class="review-list">
            <article v-for="candidate in adminCandidateRows" :key="candidate.id" class="review-row">
              <div>
                <h2>{{ candidate.title }}</h2>
                <p>{{ statusLabel(candidate.status) }} / {{ candidate.submitterName }} / {{ formatDate(candidate.createdAt) }}</p>
                <dl>
                  <template v-for="field in survey.candidateFields" :key="field.id">
                    <dt>{{ field.label }}</dt>
                    <dd>{{ candidate.fields[field.key] || '未填' }}</dd>
                  </template>
                </dl>
              </div>
              <textarea v-model="reviewNotes[candidate.id]" rows="3" :placeholder="candidate.reviewNote || '审核备注'"></textarea>
              <div class="review-actions">
                <button v-if="candidate.status !== 'approved'" class="button-primary" type="button" @click="setCandidateStatus(candidate, 'approved')">通过</button>
                <button v-if="candidate.status !== 'pending'" class="button-ghost" type="button" @click="setCandidateStatus(candidate, 'pending')">退回待审</button>
                <button v-if="candidate.status !== 'rejected'" class="button-danger" type="button" @click="setCandidateStatus(candidate, 'rejected')">拒绝</button>
              </div>
            </article>
          </div>
        </section>

        <section v-if="adminPanel === 'archive'" class="admin-card">
          <header class="admin-section-head">
            <div>
              <h1>留档</h1>
              <p>导出当前问卷的候选项、投票记录和完整 JSON。</p>
            </div>
            <div class="admin-actions">
              <button class="button-ghost" type="button" @click="exportResultsCsv">候选 CSV</button>
              <button class="button-ghost" type="button" @click="exportVotesCsv">投票 CSV</button>
              <button class="button-ghost" type="button" @click="exportJson">JSON</button>
            </div>
          </header>

          <div class="archive-grid">
            <section>
              <h2>投票记录</h2>
              <ul>
                <li v-for="vote in surveyVotes" :key="vote.id">
                  <strong>{{ vote.userName }}</strong>
                  <span>{{ vote.candidateIds.length }} 项 / {{ formatDate(vote.updatedAt) }}</span>
                </li>
              </ul>
            </section>
            <section>
              <h2>操作日志</h2>
              <ul>
                <li v-for="log in appState.auditLogs.slice(0, 10)" :key="log.id">
                  <strong>{{ log.action }}</strong>
                  <span>{{ log.detail }}</span>
                </li>
              </ul>
            </section>
          </div>
          <p v-if="latestVote" class="inline-message">最近投票更新：{{ latestVote.userName }} / {{ formatDate(latestVote.updatedAt) }}</p>
        </section>

        <p v-if="adminMessage" class="inline-message">{{ adminMessage }}</p>
      </template>
    </section>
  </main>
</template>
