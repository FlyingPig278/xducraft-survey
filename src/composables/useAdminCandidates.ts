import { computed, ref } from 'vue'
import type { Candidate, CandidateStatus } from '../types'
import { createId } from '../storage'
import { useAppState } from './useAppState'
import { useAuth } from './useAuth'
import { statusLabel } from './useCandidateFields'

type CandidateFilter = CandidateStatus | 'all'

const candidateFilter = ref<CandidateFilter>('pending')
const reviewNotes = ref<Record<string, string>>({})
const adminCandidateValues = ref<Record<string, string>>({})
const editCandidateValues = ref<Record<string, string>>({})
const editCandidateModalOpen = ref(false)
const editingCandidateId = ref('')

export function useAdminCandidates() {
  const { appState, survey, surveyById, persist, addAudit, message } = useAppState()
  const { isAdmin, currentUser } = useAuth()

  const pendingCandidateCount = computed(() => appState.value.candidates.filter((c) => c.status === 'pending').length)

  const adminCandidateRows = computed(() => {
    const rows = candidateFilter.value === 'all' ? appState.value.candidates : appState.value.candidates.filter((c) => c.status === candidateFilter.value)
    return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  })

  const editingCandidate = computed(() => appState.value.candidates.find((c) => c.id === editingCandidateId.value) ?? null)
  const editingCandidateSurvey = computed(() => editingCandidate.value ? surveyById(editingCandidate.value.surveyId) : null)
  const editingCandidateFields = computed(() => editingCandidateSurvey.value?.candidateFields ?? [])

  const validateUrl = (value: string) => {
    if (!value.trim()) return true
    try { new URL(value); return true } catch { return false }
  }
  const normalize = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ')

  const initAdminCandidateValues = () => {
    const next: Record<string, string> = {}
    survey.value.candidateFields.forEach((f) => { next[f.key] = adminCandidateValues.value[f.key] ?? '' })
    adminCandidateValues.value = next
  }

  const resetAdminCandidateValues = () => {
    const next: Record<string, string> = {}
    survey.value.candidateFields.forEach((f) => { next[f.key] = '' })
    adminCandidateValues.value = next
  }

  const titleFromValues = (values: Record<string, string>) =>
    values.packName?.trim() || values.name?.trim() || values.title?.trim() ||
    survey.value.candidateFields.map((f) => values[f.key]).find(Boolean)?.trim() || '未命名候选项'

  const createAdminCandidate = async () => {
    if (!isAdmin.value || !currentUser.value) { message.error('请先登录管理员身份。'); return }
    const surveyId = survey.value.id
    for (const field of survey.value.candidateFields) {
      const val = adminCandidateValues.value[field.key]?.trim() ?? ''
      if (field.required && !val) { message.warning(`请填写「${field.label}」。`); return }
      if (field.type === 'url' && !validateUrl(val)) { message.warning(`「${field.label}」需要是完整链接。`); return }
    }
    const title = titleFromValues(adminCandidateValues.value)
    if (appState.value.candidates.find((c) => c.surveyId === surveyId && c.status !== 'rejected' && normalize(c.title) === normalize(title))) {
      message.warning('当前问卷已经存在同名候选项。'); return
    }
    const ts = new Date().toISOString()
    appState.value.candidates.unshift({
      id: createId('candidate'), surveyId, title, status: 'approved',
      fields: { ...adminCandidateValues.value },
      submitterUserId: currentUser.value.id, submitterName: currentUser.value.displayName,
      createdAt: ts, reviewedAt: ts, reviewerName: currentUser.value.displayName
    })
    addAudit('candidate.admin_created', `${currentUser.value.displayName} 添加了「${title}」作为「${survey.value.title}」的候选项`, surveyId, currentUser.value.displayName)
    if (!(await persist(surveyId))) return
    resetAdminCandidateValues()
    message.success(`候选项「${title}」已加入当前问卷`)
  }

  const openEditCandidate = (candidate: Candidate) => {
    editingCandidateId.value = candidate.id
    const ownerSurvey = surveyById(candidate.surveyId)
    const next: Record<string, string> = {}
    if (ownerSurvey) {
      ownerSurvey.candidateFields.forEach((field) => { next[field.key] = candidate.fields[field.key] ?? '' })
    } else {
      Object.assign(next, candidate.fields)
    }
    editCandidateValues.value = next
    editCandidateModalOpen.value = true
  }

  const saveCandidateEdit = async () => {
    if (!isAdmin.value || !currentUser.value) { message.error('请先登录管理员身份。'); return }
    const candidate = editingCandidate.value
    const ownerSurvey = editingCandidateSurvey.value
    if (!candidate || !ownerSurvey) { message.error('候选项不存在。'); return }
    const cleanedValues = Object.fromEntries(Object.entries(editCandidateValues.value).map(([key, value]) => [key, value.trim()]))
    for (const field of ownerSurvey.candidateFields) {
      const val = cleanedValues[field.key] ?? ''
      if (field.required && !val) { message.warning(`请填写「${field.label}」。`); return }
      if (field.type === 'url' && !validateUrl(val)) { message.warning(`「${field.label}」需要是完整链接。`); return }
    }
    const title = cleanedValues.packName || cleanedValues.name || cleanedValues.title ||
      ownerSurvey.candidateFields.map((f) => cleanedValues[f.key]).find(Boolean)?.trim() || candidate.title
    if (appState.value.candidates.find((item) => item.id !== candidate.id && item.surveyId === candidate.surveyId && item.status !== 'rejected' && normalize(item.title) === normalize(title))) {
      message.warning('当前问卷已经存在同名候选项。'); return
    }
    candidate.title = title
    candidate.fields = { ...candidate.fields, ...cleanedValues }
    candidate.reviewedAt = new Date().toISOString()
    candidate.reviewerName = currentUser.value.displayName
    addAudit('candidate.edited', `${currentUser.value.displayName} 修改了候选项「${title}」`, candidate.surveyId, currentUser.value.displayName)
    if (!(await persist(candidate.surveyId))) return
    editCandidateModalOpen.value = false
    editingCandidateId.value = ''
    message.success(`候选项「${title}」已保存`)
  }

  const setCandidateStatus = async (candidate: Candidate, status: CandidateStatus) => {
    if (!isAdmin.value || !currentUser.value) { message.error('请先登录管理员身份。'); return }
    const surveyId = candidate.surveyId
    candidate.status = status
    candidate.reviewedAt = new Date().toISOString()
    candidate.reviewerName = currentUser.value.displayName
    candidate.reviewNote = reviewNotes.value[candidate.id] ?? candidate.reviewNote ?? ''
    addAudit(`candidate.${status}`, `${currentUser.value.displayName} 将「${candidate.title}」标记为${statusLabel(status)}`, surveyId, currentUser.value.displayName)
    if (!(await persist(surveyId))) return
    message.success(`「${candidate.title}」已标记为${statusLabel(status)}`)
  }

  return {
    candidateFilter,
    reviewNotes,
    adminCandidateValues,
    editCandidateValues,
    editCandidateModalOpen,
    editingCandidateId,
    pendingCandidateCount,
    adminCandidateRows,
    editingCandidate,
    editingCandidateSurvey,
    editingCandidateFields,
    initAdminCandidateValues,
    resetAdminCandidateValues,
    createAdminCandidate,
    openEditCandidate,
    saveCandidateEdit,
    setCandidateStatus
  }
}
