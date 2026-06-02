<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  createId,
  createSeedState,
  loadState,
  loadUser,
  saveState,
  saveUser
} from './storage'
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

type TabKey = 'vote' | 'submit' | 'admin'
type AdminPanelKey = 'surveys' | 'fields' | 'candidates' | 'archive'
type CandidateFilter = CandidateStatus | 'all'

interface ResultRow {
  candidate: Candidate
  count: number
  percent: number
}

const appState = ref<AppState>(loadState())
const currentUser = ref<MockUser | null>(loadUser())
const activeSurveyId = ref(appState.value.surveys[0]?.id ?? '')
const activeTab = ref<TabKey>('vote')
const adminPanel = ref<AdminPanelKey>('surveys')
const candidateFilter = ref<CandidateFilter>('pending')
const selectedCandidateIds = ref<string[]>([])
const statusMessage = ref('')
const submissionMessage = ref('')
const adminMessage = ref('')
const reviewNotes = ref<Record<string, string>>({})
const submissionValues = ref<Record<string, string>>({})

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
  allowVoteEdits: true,
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
    placeholder: '简单说说它为什么适合服务器'
  }
]

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

const surveys = computed(() =>
  [...appState.value.surveys].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
)

const survey = computed<SurveyDefinition>(() => {
  const selected = appState.value.surveys.find((item) => item.id === activeSurveyId.value)
  return selected ?? appState.value.surveys[0]!
})

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
const isAdmin = computed(() => currentUser.value?.role === 'admin')
const voteLimit = computed(() => (survey.value.voteMode === 'single' ? 1 : Math.max(1, survey.value.maxVotes || 1)))
const currentVote = computed(() => {
  if (!currentUser.value) return null
  return surveyVotes.value.find((vote) => vote.userId === currentUser.value?.id) ?? null
})
const totalVoters = computed(() => surveyVotes.value.length)
const totalSelections = computed(() =>
  surveyVotes.value.reduce((total, vote) => total + vote.candidateIds.length, 0)
)
const latestVote = computed(() =>
  [...surveyVotes.value].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
)
const approvedCandidateIds = computed(() => new Set(approvedCandidates.value.map((candidate) => candidate.id)))
const selectedCandidates = computed(() =>
  selectedCandidateIds.value
    .map((candidateId) => approvedCandidates.value.find((candidate) => candidate.id === candidateId))
    .filter((candidate): candidate is Candidate => Boolean(candidate))
)
const summaryFields = computed(() =>
  survey.value.candidateFields.filter((field) => field.key !== 'packName' && field.type !== 'textarea').slice(0, 5)
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
const leadingRow = computed(() => resultRows.value[0] ?? null)
const adminCandidateRows = computed(() => {
  const rows =
    candidateFilter.value === 'all'
      ? surveyCandidates.value
      : surveyCandidates.value.filter((candidate) => candidate.status === candidateFilter.value)
  return [...rows].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
})

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

const voteModeLabel = (mode: VoteMode) => (mode === 'single' ? '单选' : `最多 ${voteLimit.value} 票`)

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

const candidateLinks = (candidate: Candidate) =>
  survey.value.candidateFields
    .filter((field) => field.type === 'url')
    .map((field) => ({ field, value: candidate.fields[field.key]?.trim() ?? '' }))
    .filter((item) => item.value && validateUrl(item.value))
    .slice(0, 3)

const candidateTitleById = (candidateId: string) =>
  approvedCandidates.value.find((candidate) => candidate.id === candidateId)?.title ?? '未知候选项'

const initSubmissionValues = () => {
  const nextValues: Record<string, string> = {}
  survey.value.candidateFields.forEach((field) => {
    nextValues[field.key] = submissionValues.value[field.key] ?? ''
  })
  submissionValues.value = nextValues
}

const syncSelectionFromVote = () => {
  selectedCandidateIds.value = currentVote.value
    ? currentVote.value.candidateIds.filter((candidateId) => approvedCandidateIds.value.has(candidateId))
    : []
}

const selectSurvey = (surveyId: string) => {
  activeSurveyId.value = surveyId
  statusMessage.value = ''
  submissionMessage.value = ''
  adminMessage.value = ''
}

watch(
  () => appState.value.surveys.map((item) => item.id).join('|'),
  () => {
    if (!appState.value.surveys.some((item) => item.id === activeSurveyId.value)) {
      activeSurveyId.value = appState.value.surveys[0]?.id ?? ''
    }
  },
  { immediate: true }
)
watch(activeSurveyId, () => {
  initSubmissionValues()
  syncSelectionFromVote()
})
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
  statusMessage.value = role === 'admin' ? '已使用 mock 管理员身份登录。' : '已使用 mock Blessing Skin 身份登录。'
  syncSelectionFromVote()
}

const logout = () => {
  currentUser.value = null
  saveUser(null)
  statusMessage.value = '已退出当前 mock 身份。'
}

const isSelected = (candidateId: string) => selectedCandidateIds.value.includes(candidateId)

const toggleCandidate = (candidateId: string) => {
  statusMessage.value = ''
  if (survey.value.status !== 'open') {
    statusMessage.value = '当前问卷不在开放投票状态。'
    return
  }
  if (!approvedCandidateIds.value.has(candidateId)) {
    statusMessage.value = '该候选项尚未通过审核。'
    return
  }

  if (survey.value.voteMode === 'single') {
    selectedCandidateIds.value = isSelected(candidateId) ? [] : [candidateId]
    return
  }

  if (isSelected(candidateId)) {
    selectedCandidateIds.value = selectedCandidateIds.value.filter((id) => id !== candidateId)
    return
  }

  if (selectedCandidateIds.value.length >= voteLimit.value) {
    statusMessage.value = `本问卷最多可选择 ${voteLimit.value} 个候选项。`
    return
  }

  selectedCandidateIds.value = [...selectedCandidateIds.value, candidateId]
}

const submitVote = () => {
  statusMessage.value = ''
  if (!currentUser.value) {
    statusMessage.value = '请先使用 mock Blessing Skin 登录后再投票。'
    return
  }
  if (survey.value.status !== 'open') {
    statusMessage.value = '当前问卷不在开放投票状态。'
    return
  }

  const validSelection = selectedCandidateIds.value.filter((candidateId) =>
    approvedCandidateIds.value.has(candidateId)
  )
  selectedCandidateIds.value = [...new Set(validSelection)]

  if (selectedCandidateIds.value.length === 0) {
    statusMessage.value = '请至少选择一个候选项。'
    return
  }
  if (selectedCandidateIds.value.length > voteLimit.value) {
    statusMessage.value = `选择数量超过限制，最多 ${voteLimit.value} 个。`
    return
  }
  if (currentVote.value && !survey.value.allowVoteEdits) {
    statusMessage.value = '该问卷已关闭投票修改。'
    return
  }

  const timestamp = new Date().toISOString()
  if (currentVote.value) {
    currentVote.value.history.push({
      candidateIds: [...currentVote.value.candidateIds],
      changedAt: currentVote.value.updatedAt
    })
    currentVote.value.candidateIds = [...selectedCandidateIds.value]
    currentVote.value.updatedAt = timestamp
    addAudit('vote.updated', `${currentUser.value.displayName} 修改了「${survey.value.title}」的投票`)
    statusMessage.value = '投票已更新，历史版本已留档。'
    return
  }

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
  statusMessage.value = '投票已提交。'
}

const submitCandidate = () => {
  submissionMessage.value = ''
  if (!currentUser.value) {
    submissionMessage.value = '请先使用 mock Blessing Skin 登录后再提交候选项。'
    return
  }
  if (survey.value.status !== 'open') {
    submissionMessage.value = '当前问卷不在开放投稿状态。'
    return
  }
  if (!survey.value.candidateSubmission.enabled) {
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
  initSubmissionValues()
  submissionMessage.value =
    status === 'pending' ? '候选项已提交，等待管理员审核。' : '候选项已提交，并已进入投票列表。'
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
    description: surveyDraft.description.trim() || '新的社区问卷。',
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
  activeSurveyId.value = nextSurvey.id
  surveyDraft.title = ''
  surveyDraft.description = ''
  addAudit('survey.created', `${currentUser.value.displayName} 创建了问卷「${nextSurvey.title}」`)
  adminMessage.value = '新问卷已创建，当前状态为草稿。'
}

const resetDemo = () => {
  appState.value = createSeedState()
  activeSurveyId.value = appState.value.surveys[0]?.id ?? ''
  saveState(appState.value)
  initSubmissionValues()
  syncSelectionFromVote()
  adminMessage.value = '演示数据已重置。'
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
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">XD</div>
        <div>
          <p class="eyebrow">XDUCraft Survey</p>
          <h1>社区问卷与服务器投票</h1>
        </div>
      </div>

      <nav class="tabs" aria-label="主视图">
        <button v-if="activeTab === 'admin'" type="button" @click="activeTab = 'vote'">
          返回投票
        </button>
        <button v-else type="button" @click="activeTab = 'admin'">
          管理后台
          <span v-if="pendingCandidateCount" class="nav-badge">{{ pendingCandidateCount }}</span>
        </button>
      </nav>
    </header>

    <main v-if="activeTab !== 'admin'" class="player-layout">
      <section class="player-toolbar">
        <label class="survey-select">
          <span>当前问卷</span>
          <select :value="survey.id" @change="selectSurvey(($event.target as HTMLSelectElement).value)">
            <option v-for="item in surveys" :key="item.id" :value="item.id">
              {{ item.title }}
            </option>
          </select>
        </label>

        <div v-if="currentUser" class="player-user">
          <span>{{ currentUser.displayName }}</span>
          <small>{{ currentUser.gameId }} · {{ currentUser.role }}</small>
          <button class="ghost" type="button" @click="logout">退出</button>
        </div>
        <form v-else class="player-login" @submit.prevent="loginAs('player')">
          <input v-model="loginDraft.displayName" type="text" aria-label="显示名" placeholder="显示名" />
          <input v-model="loginDraft.gameId" type="text" aria-label="游戏 ID" placeholder="游戏 ID" />
          <button class="primary" type="submit">登录</button>
          <button class="ghost" type="button" @click="loginAs('admin')">管理员</button>
        </form>
      </section>

      <section class="vote-board">
        <header class="vote-board-head">
          <div>
            <div class="chip-row">
              <span class="chip" :class="survey.status">{{ statusLabel(survey.status) }}</span>
              <span class="chip">{{ voteModeLabel(survey.voteMode) }}</span>
              <span class="chip">{{ survey.allowVoteEdits ? '可修改' : '不可修改' }}</span>
              <span class="chip">{{ survey.publicResults ? '公开票数' : '隐藏票数' }}</span>
            </div>
            <h2>{{ survey.title }}</h2>
            <p>{{ survey.description }}</p>
          </div>

          <div class="player-stats" aria-label="投票概览">
            <span><strong>{{ approvedCandidates.length }}</strong> 候选</span>
            <span><strong>{{ totalVoters }}</strong> 玩家</span>
            <span><strong>{{ totalSelections }}</strong> 选择</span>
          </div>
        </header>

        <div v-if="approvedCandidates.length === 0" class="empty-state">当前问卷还没有可投候选项。</div>

        <div v-else class="bar-chart" aria-label="候选项实时票数">
          <article
            v-for="row in resultRows"
            :key="row.candidate.id"
            class="bar-row"
            :class="{ selected: isSelected(row.candidate.id) }"
            role="button"
            tabindex="0"
            @click="toggleCandidate(row.candidate.id)"
            @keydown.enter="toggleCandidate(row.candidate.id)"
          >
            <div
              v-if="survey.publicResults"
              class="bar-row-fill"
              :style="{ width: `${row.count > 0 ? Math.max(row.percent, 3) : 0}%` }"
            ></div>
            <div class="bar-row-content">
              <div class="bar-copy">
                <strong>{{ row.candidate.title }}</strong>
                <small>
                  <template v-for="(field, index) in summaryFields.slice(0, 3)" :key="field.id">
                    <span v-if="index > 0"> · </span>{{ row.candidate.fields[field.key] || '未填' }}
                  </template>
                </small>
              </div>
              <div class="bar-count">
                <span>{{ isSelected(row.candidate.id) ? '已选' : '点击选择' }}</span>
                <strong>{{ survey.publicResults ? `${row.count} 票` : '票数隐藏' }}</strong>
              </div>
            </div>
          </article>
        </div>

        <footer class="player-actions">
          <div class="selection-line">
            <strong>{{ selectedCandidateIds.length }} / {{ voteLimit }}</strong>
            <span v-if="selectedCandidates.length">
              {{ selectedCandidates.map((candidate) => candidate.title).join('、') }}
            </span>
            <span v-else>尚未选择候选项</span>
          </div>

          <div class="action-row">
            <button class="primary" type="button" @click="submitVote">
              {{ currentVote ? '更新投票' : '提交投票' }}
            </button>
            <button class="ghost" type="button" @click="selectedCandidateIds = []">清空</button>
            <button
              class="ghost"
              type="button"
              @click="activeTab = activeTab === 'submit' ? 'vote' : 'submit'"
            >
              {{ activeTab === 'submit' ? '收起投稿' : '我想添加候选项' }}
            </button>
          </div>
        </footer>

        <p v-if="statusMessage" class="message">{{ statusMessage }}</p>
        <p v-if="currentVote" class="muted">
          上次提交：{{ formatDate(currentVote.updatedAt) }}，历史版本 {{ currentVote.history.length }} 条。
        </p>
      </section>

      <section v-if="activeTab === 'submit'" class="submit-drawer">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Candidate Submission</p>
            <h2>新增候选项</h2>
          </div>
          <span class="state-label">
            {{ survey.candidateSubmission.requiresReview ? '提交后需审核' : '提交后自动进入列表' }}
          </span>
        </div>

        <div
          v-if="survey.status !== 'open' || !survey.candidateSubmission.enabled"
          class="empty-state"
        >
          当前问卷没有开放候选项投稿。
        </div>

        <form v-else class="dynamic-form" @submit.prevent="submitCandidate">
          <label
            v-for="field in survey.candidateFields"
            :key="field.id"
            class="field"
            :class="{ wide: field.type === 'textarea' }"
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

          <div class="form-actions wide">
            <button class="primary" type="submit">提交候选项</button>
            <button class="ghost" type="button" @click="initSubmissionValues">重置</button>
          </div>
          <p v-if="submissionMessage" class="message wide">{{ submissionMessage }}</p>
        </form>
      </section>
    </main>

    <main v-show="activeTab === 'admin'" class="app-layout">
      <aside class="sidebar">
        <section class="panel survey-picker">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Surveys</p>
              <h2>问卷</h2>
            </div>
            <button
              v-if="isAdmin"
              class="mini-button"
              type="button"
              @click="activeTab = 'admin'; adminPanel = 'surveys'"
            >
              新建
            </button>
          </div>

          <div class="survey-list">
            <button
              v-for="item in surveys"
              :key="item.id"
              class="survey-switch"
              :class="{ active: item.id === survey.id }"
              type="button"
              @click="selectSurvey(item.id)"
            >
              <span>{{ item.title }}</span>
              <small>
                {{ statusLabel(item.status) }} ·
                {{ appState.candidates.filter((candidate) => candidate.surveyId === item.id).length }} 候选
              </small>
            </button>
          </div>
        </section>

        <section class="panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Mock OAuth2</p>
              <h2>Blessing Skin 身份</h2>
            </div>
          </div>

          <div v-if="currentUser" class="current-user">
            <strong>{{ currentUser.displayName }}</strong>
            <span>{{ currentUser.gameId }} · {{ currentUser.role }}</span>
            <button class="ghost full" type="button" @click="logout">退出登录</button>
          </div>
          <form v-else class="login-form" @submit.prevent="loginAs('player')">
            <label class="field">
              <span>显示名</span>
              <input v-model="loginDraft.displayName" type="text" />
            </label>
            <label class="field">
              <span>游戏 ID</span>
              <input v-model="loginDraft.gameId" type="text" />
            </label>
            <button class="primary full" type="submit">模拟玩家登录</button>
            <button class="ghost full" type="button" @click="loginAs('admin')">模拟管理员登录</button>
          </form>
        </section>

        <section class="panel compact">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Audit</p>
              <h2>最近留档</h2>
            </div>
          </div>
          <ul class="audit-list">
            <li v-for="log in appState.auditLogs.slice(0, 6)" :key="log.id">
              <span>{{ log.action }}</span>
              <strong>{{ log.detail }}</strong>
              <small>{{ log.actor }} · {{ formatDate(log.createdAt) }}</small>
            </li>
          </ul>
        </section>
      </aside>

      <section class="workspace">
        <section class="survey-summary">
          <div class="summary-main">
            <div class="chip-row">
              <span class="chip" :class="survey.status">{{ statusLabel(survey.status) }}</span>
              <span class="chip">{{ voteModeLabel(survey.voteMode) }}</span>
              <span class="chip">{{ survey.allowVoteEdits ? '可修改' : '不可修改' }}</span>
              <span class="chip">{{ survey.publicResults ? '公开票数' : '隐藏票数' }}</span>
              <span class="chip">{{ survey.candidateSubmission.requiresReview ? '投稿审核' : '自动通过' }}</span>
            </div>
            <h2>{{ survey.title }}</h2>
            <p>{{ survey.description }}</p>
          </div>
          <div class="stat-strip" aria-label="投票概览">
            <div>
              <strong>{{ approvedCandidates.length }}</strong>
              <span>可投候选</span>
            </div>
            <div>
              <strong>{{ totalVoters }}</strong>
              <span>已投玩家</span>
            </div>
            <div>
              <strong>{{ totalSelections }}</strong>
              <span>总选择数</span>
            </div>
            <div>
              <strong>{{ pendingCandidates.length }}</strong>
              <span>待审核</span>
            </div>
          </div>
        </section>

        <section v-if="activeTab === 'vote'" class="vote-layout">
          <div class="panel result-panel">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Live Ranking</p>
                <h2>实时匿名票数</h2>
              </div>
              <div v-if="leadingRow" class="leader-pill">
                <span>当前第一</span>
                <strong>{{ leadingRow.candidate.title }}</strong>
              </div>
            </div>

            <div v-if="approvedCandidates.length === 0" class="empty-state">当前问卷还没有可投候选项。</div>

            <div v-else class="candidate-list">
              <article
                v-for="row in resultRows"
                :key="row.candidate.id"
                class="candidate-card"
                :class="{ selected: isSelected(row.candidate.id) }"
              >
                <button class="check-button" type="button" @click="toggleCandidate(row.candidate.id)">
                  {{ isSelected(row.candidate.id) ? '已选' : '选择' }}
                </button>

                <div class="candidate-body">
                  <div class="candidate-title-line">
                    <h3>{{ row.candidate.title }}</h3>
                    <strong v-if="survey.publicResults">{{ row.count }} 票</strong>
                    <strong v-else>票数隐藏</strong>
                  </div>

                  <div class="candidate-meta">
                    <span v-for="field in summaryFields" :key="field.id">
                      {{ field.label }}：{{ row.candidate.fields[field.key] || '未填' }}
                    </span>
                  </div>

                  <p v-if="row.candidate.fields.notes" class="candidate-note">
                    {{ row.candidate.fields.notes }}
                  </p>

                  <div class="candidate-actions" v-if="candidateLinks(row.candidate).length">
                    <a
                      v-for="link in candidateLinks(row.candidate)"
                      :key="link.field.id"
                      :href="link.value"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {{ link.field.label }}
                    </a>
                  </div>

                  <div v-if="survey.publicResults" class="bar-track" aria-hidden="true">
                    <div class="bar-fill" :style="{ width: `${row.percent}%` }"></div>
                  </div>
                </div>
              </article>
            </div>
          </div>

          <aside class="panel vote-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Your Vote</p>
                <h2>我的选择</h2>
              </div>
            </div>

            <div class="selection-summary">
              <strong>{{ selectedCandidateIds.length }} / {{ voteLimit }}</strong>
              <span>{{ survey.voteMode === 'single' ? '当前单选' : '已选择名额' }}</span>
            </div>

            <ul v-if="selectedCandidates.length" class="selected-list">
              <li v-for="candidate in selectedCandidates" :key="candidate.id">{{ candidate.title }}</li>
            </ul>
            <p v-else class="muted">还没有选择候选项。</p>

            <button class="primary full" type="button" @click="submitVote">
              {{ currentVote ? '更新投票' : '提交投票' }}
            </button>
            <button class="ghost full" type="button" @click="selectedCandidateIds = []">清空选择</button>
            <p v-if="statusMessage" class="message">{{ statusMessage }}</p>
            <p v-if="currentVote" class="muted">
              上次提交：{{ formatDate(currentVote.updatedAt) }}，历史版本 {{ currentVote.history.length }} 条。
            </p>
          </aside>
        </section>

        <section v-if="activeTab === 'submit'" class="panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Candidate Submission</p>
              <h2>新增服务器候选项</h2>
            </div>
            <span class="state-label">
              {{ survey.candidateSubmission.requiresReview ? '提交后需审核' : '提交后自动进入列表' }}
            </span>
          </div>

          <div
            v-if="survey.status !== 'open' || !survey.candidateSubmission.enabled"
            class="empty-state"
          >
            当前问卷没有开放候选项投稿。
          </div>

          <form v-else class="dynamic-form" @submit.prevent="submitCandidate">
            <label
              v-for="field in survey.candidateFields"
              :key="field.id"
              class="field"
              :class="{ wide: field.type === 'textarea' }"
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

            <div class="form-actions wide">
              <button class="primary" type="submit">提交候选项</button>
              <button class="ghost" type="button" @click="initSubmissionValues">重置表单</button>
            </div>
            <p v-if="submissionMessage" class="message wide">{{ submissionMessage }}</p>
          </form>
        </section>

        <section v-if="activeTab === 'admin'" class="admin-stack">
          <div v-if="!isAdmin" class="panel empty-state">
            管理后台需要 mock 管理员身份。左侧登录面板可以切换。
          </div>

          <template v-else>
            <div class="admin-tabs" aria-label="管理视图">
              <button :class="{ active: adminPanel === 'surveys' }" type="button" @click="adminPanel = 'surveys'">
                问卷规则
              </button>
              <button :class="{ active: adminPanel === 'fields' }" type="button" @click="adminPanel = 'fields'">
                投稿字段
              </button>
              <button
                :class="{ active: adminPanel === 'candidates' }"
                type="button"
                @click="adminPanel = 'candidates'"
              >
                候选审核
              </button>
              <button :class="{ active: adminPanel === 'archive' }" type="button" @click="adminPanel = 'archive'">
                留档导出
              </button>
            </div>

            <section v-if="adminPanel === 'surveys'" class="admin-grid">
              <div class="panel">
                <div class="section-heading">
                  <div>
                    <p class="eyebrow">Survey Rules</p>
                    <h2>当前问卷规则</h2>
                  </div>
                  <button class="ghost" type="button" @click="resetDemo">重置演示数据</button>
                </div>

                <div class="settings-grid">
                  <label class="field">
                    <span>问卷标题</span>
                    <input v-model="survey.title" type="text" @change="touchSurvey" />
                  </label>
                  <label class="field">
                    <span>状态</span>
                    <select v-model="survey.status" @change="touchSurvey">
                      <option value="draft">草稿</option>
                      <option value="open">开放</option>
                      <option value="closed">已关闭</option>
                    </select>
                  </label>
                  <label class="field wide">
                    <span>说明</span>
                    <textarea v-model="survey.description" rows="4" @change="touchSurvey"></textarea>
                  </label>
                  <label class="field">
                    <span>投票模式</span>
                    <select v-model="survey.voteMode" @change="touchSurvey">
                      <option value="single">单选</option>
                      <option value="multiple">多选</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>最多票数</span>
                    <input v-model.number="survey.maxVotes" min="1" type="number" @change="touchSurvey" />
                  </label>
                </div>

                <div class="toggle-grid">
                  <label><input v-model="survey.publicResults" type="checkbox" @change="touchSurvey" /> 公开实时票数</label>
                  <label><input v-model="survey.allowVoteEdits" type="checkbox" @change="touchSurvey" /> 允许修改投票</label>
                  <label>
                    <input v-model="survey.candidateSubmission.enabled" type="checkbox" @change="touchSurvey" />
                    开放候选项投稿
                  </label>
                  <label>
                    <input v-model="survey.candidateSubmission.requiresReview" type="checkbox" @change="touchSurvey" />
                    投稿需要审核
                  </label>
                </div>
              </div>

              <div class="panel">
                <div class="section-heading">
                  <div>
                    <p class="eyebrow">Create</p>
                    <h2>新建问卷</h2>
                  </div>
                </div>

                <form class="dynamic-form single" @submit.prevent="createSurvey">
                  <label class="field">
                    <span>标题</span>
                    <input v-model="surveyDraft.title" type="text" placeholder="例如 夏季短期服方案投票" />
                  </label>
                  <label class="field">
                    <span>说明</span>
                    <textarea v-model="surveyDraft.description" rows="3"></textarea>
                  </label>
                  <div class="split-fields">
                    <label class="field">
                      <span>投票模式</span>
                      <select v-model="surveyDraft.voteMode">
                        <option value="single">单选</option>
                        <option value="multiple">多选</option>
                      </select>
                    </label>
                    <label class="field">
                      <span>最多票数</span>
                      <input v-model.number="surveyDraft.maxVotes" min="1" type="number" />
                    </label>
                  </div>
                  <div class="toggle-grid compact-toggle">
                    <label><input v-model="surveyDraft.publicResults" type="checkbox" /> 公开票数</label>
                    <label><input v-model="surveyDraft.allowVoteEdits" type="checkbox" /> 可修改</label>
                    <label><input v-model="surveyDraft.candidateSubmissionEnabled" type="checkbox" /> 开放投稿</label>
                    <label><input v-model="surveyDraft.candidateSubmissionRequiresReview" type="checkbox" /> 投稿审核</label>
                    <label><input v-model="surveyDraft.cloneCurrentFields" type="checkbox" /> 复制当前字段</label>
                  </div>
                  <button class="primary" type="submit">创建问卷</button>
                </form>
              </div>
            </section>

            <section v-if="adminPanel === 'fields'" class="panel">
              <div class="section-heading">
                <div>
                  <p class="eyebrow">Submission Schema</p>
                  <h2>候选项投稿字段</h2>
                </div>
              </div>

              <div class="field-builder">
                <article v-for="field in survey.candidateFields" :key="field.id" class="schema-row">
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
                  <label class="inline-check">
                    <input v-model="field.required" type="checkbox" @change="touchSurvey" />
                    必填
                  </label>
                  <label>
                    <span>占位文本</span>
                    <input v-model="field.placeholder" type="text" @change="touchSurvey" />
                  </label>
                  <label class="schema-options">
                    <span>选项，每行一个</span>
                    <textarea
                      :value="fieldOptions(field).join('\n')"
                      rows="3"
                      @change="updateFieldOptions(field, ($event.target as HTMLTextAreaElement).value)"
                    ></textarea>
                  </label>
                  <button class="danger" type="button" @click="removeField(field)">移除</button>
                </article>

                <article class="schema-row add-row">
                  <label>
                    <span>新字段名称</span>
                    <input v-model="newField.label" type="text" placeholder="例如 开服建议人数" />
                  </label>
                  <label>
                    <span>Key</span>
                    <input v-model="newField.key" type="text" placeholder="可留空自动生成" />
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
                  <label class="inline-check">
                    <input v-model="newField.required" type="checkbox" />
                    必填
                  </label>
                  <label>
                    <span>占位文本</span>
                    <input v-model="newField.placeholder" type="text" />
                  </label>
                  <label class="schema-options">
                    <span>选项，每行一个</span>
                    <textarea v-model="newField.optionsText" rows="3"></textarea>
                  </label>
                  <button class="primary" type="button" @click="addField">添加字段</button>
                </article>
              </div>
              <p v-if="adminMessage" class="message">{{ adminMessage }}</p>
            </section>

            <section v-if="adminPanel === 'candidates'" class="panel">
              <div class="section-heading">
                <div>
                  <p class="eyebrow">Moderation</p>
                  <h2>候选项审核</h2>
                </div>
                <div class="filter-tabs">
                  <button :class="{ active: candidateFilter === 'pending' }" type="button" @click="candidateFilter = 'pending'">
                    待审核 {{ pendingCandidates.length }}
                  </button>
                  <button :class="{ active: candidateFilter === 'approved' }" type="button" @click="candidateFilter = 'approved'">
                    已通过 {{ approvedCandidates.length }}
                  </button>
                  <button :class="{ active: candidateFilter === 'rejected' }" type="button" @click="candidateFilter = 'rejected'">
                    已拒绝 {{ rejectedCandidates.length }}
                  </button>
                  <button :class="{ active: candidateFilter === 'all' }" type="button" @click="candidateFilter = 'all'">
                    全部
                  </button>
                </div>
              </div>

              <div v-if="adminCandidateRows.length === 0" class="empty-state">当前筛选下没有候选项。</div>
              <div v-else class="moderation-list">
                <article v-for="candidate in adminCandidateRows" :key="candidate.id" class="moderation-item">
                  <div class="moderation-main">
                    <div class="candidate-title-line">
                      <h3>{{ candidate.title }}</h3>
                      <span class="state-label" :class="candidate.status">{{ statusLabel(candidate.status) }}</span>
                    </div>
                    <p class="muted">投稿人：{{ candidate.submitterName }} · {{ formatDate(candidate.createdAt) }}</p>
                    <div class="candidate-meta">
                      <span v-for="field in survey.candidateFields" :key="field.id">
                        {{ field.label }}：{{ candidate.fields[field.key] || '未填' }}
                      </span>
                    </div>
                  </div>
                  <textarea
                    v-model="reviewNotes[candidate.id]"
                    rows="2"
                    :placeholder="candidate.reviewNote || '审核备注，可留空'"
                  ></textarea>
                  <div class="form-actions moderation-actions">
                    <button
                      v-if="candidate.status !== 'approved'"
                      class="primary"
                      type="button"
                      @click="setCandidateStatus(candidate, 'approved')"
                    >
                      通过
                    </button>
                    <button
                      v-if="candidate.status !== 'pending'"
                      class="ghost"
                      type="button"
                      @click="setCandidateStatus(candidate, 'pending')"
                    >
                      退回待审
                    </button>
                    <button
                      v-if="candidate.status !== 'rejected'"
                      class="danger"
                      type="button"
                      @click="setCandidateStatus(candidate, 'rejected')"
                    >
                      拒绝
                    </button>
                  </div>
                </article>
              </div>
              <p v-if="adminMessage" class="message">{{ adminMessage }}</p>
            </section>

            <section v-if="adminPanel === 'archive'" class="panel">
              <div class="section-heading">
                <div>
                  <p class="eyebrow">Archive</p>
                  <h2>留档与导出</h2>
                </div>
                <div class="form-actions">
                  <button class="ghost" type="button" @click="exportResultsCsv">导出候选 CSV</button>
                  <button class="ghost" type="button" @click="exportVotesCsv">导出投票 CSV</button>
                  <button class="ghost" type="button" @click="exportJson">导出 JSON</button>
                </div>
              </div>

              <div class="archive-grid">
                <div>
                  <h3>投票记录</h3>
                  <ul class="record-list">
                    <li v-for="vote in surveyVotes" :key="vote.id">
                      <strong>{{ vote.userName }}</strong>
                      <span>{{ vote.candidateIds.length }} 项 · {{ formatDate(vote.updatedAt) }}</span>
                    </li>
                  </ul>
                </div>
                <div>
                  <h3>候选项留档</h3>
                  <ul class="record-list">
                    <li v-for="candidate in surveyCandidates" :key="candidate.id">
                      <strong>{{ candidate.title }}</strong>
                      <span>{{ statusLabel(candidate.status) }} · {{ candidateCounts.get(candidate.id) ?? 0 }} 票</span>
                    </li>
                  </ul>
                </div>
              </div>

              <p v-if="latestVote" class="message">最近投票更新：{{ latestVote.userName }} · {{ formatDate(latestVote.updatedAt) }}</p>
            </section>
          </template>
        </section>
      </section>
    </main>
  </div>
</template>
