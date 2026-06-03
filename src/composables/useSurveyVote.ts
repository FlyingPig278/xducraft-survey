import { computed, ref } from 'vue'
import type { Candidate, CandidateStatus } from '../types'
import { useAppState } from './useAppState'
import { useAuth } from './useAuth'
import { createId } from '../storage'
import { getSurveyAvailability, isSurveyAcceptingSubmissions } from './useSurveyAvailability'

const selectedCandidateIds = ref<string[]>([])
const voteConfirmOpen = ref(false)
const candidateModalOpen = ref(false)
const submittedSurveyId = ref('')
const editingVote = ref(false)
const submissionMessage = ref('')
const submissionValues = ref<Record<string, string>>({})

export function useSurveyVote() {
  const { appState, survey, persist, addAudit, message } = useAppState()
  const { currentUser, effectiveUserId, currentActorName, currentGameId, guestDraft, requestGuestName, startOAuthLogin } = useAuth()

  const surveyCandidates = computed(() => appState.value.candidates.filter((c) => c.surveyId === survey.value.id))
  const surveyVotes = computed(() => appState.value.votes.filter((v) => v.surveyId === survey.value.id))
  const approvedCandidates = computed(() => surveyCandidates.value.filter((c) => c.status === 'approved'))
  const approvedCandidateIds = computed(() => new Set(approvedCandidates.value.map((c) => c.id)))
  const voteLimit = computed(() => survey.value.voteMode === 'single' ? 1 : Math.max(1, survey.value.maxVotes || 1))

  const currentVote = computed(() => {
    if (survey.value.requireLogin && !currentUser.value) return null
    return surveyVotes.value.find((v) => v.userId === effectiveUserId.value) ?? null
  })

  const hasSubmittedCurrentSurvey = computed(() => Boolean(currentVote.value) || submittedSurveyId.value === survey.value.id)
  const showSubmissionSummary = computed(() => hasSubmittedCurrentSurvey.value && !editingVote.value)

  const totalVoters = computed(() => surveyVotes.value.length)
  const totalSelections = computed(() => surveyVotes.value.reduce((t, v) => t + v.candidateIds.length, 0))
  const candidateCounts = computed(() => {
    const counts = new Map<string, number>()
    surveyVotes.value.forEach((v) => { v.candidateIds.forEach((id) => { counts.set(id, (counts.get(id) ?? 0) + 1) }) })
    return counts
  })

  const selectedCandidates = computed(() =>
    selectedCandidateIds.value.map((id) => approvedCandidates.value.find((c) => c.id === id)).filter((c): c is Candidate => Boolean(c))
  )

  const isSelected = (id: string) => selectedCandidateIds.value.includes(id)
  const countForCandidate = (id: string) => candidateCounts.value.get(id) ?? 0
  const percentForCandidate = (id: string) => totalVoters.value > 0 ? Math.round((countForCandidate(id) / totalVoters.value) * 100) : 0

  const pruneSelectionToApproved = () => {
    const next = selectedCandidateIds.value.filter((id) => approvedCandidateIds.value.has(id))
    if (next.length !== selectedCandidateIds.value.length) selectedCandidateIds.value = next
  }

  const clampSelectionToVoteLimit = () => {
    pruneSelectionToApproved()
    if (selectedCandidateIds.value.length > voteLimit.value) {
      selectedCandidateIds.value = selectedCandidateIds.value.slice(0, voteLimit.value)
    }
  }

  const syncSelectionFromVote = () => {
    selectedCandidateIds.value = currentVote.value
      ? [...new Set(currentVote.value.candidateIds.filter((id) => approvedCandidateIds.value.has(id)))].slice(0, voteLimit.value)
      : []
  }

  const toggleCandidate = (candidateId: string) => {
    if (hasSubmittedCurrentSurvey.value && !survey.value.allowVoteEdits) return
    if (!isSurveyAcceptingSubmissions(survey.value)) { message.warning(getSurveyAvailability(survey.value).message); return }
    if (!approvedCandidateIds.value.has(candidateId)) return
    if (survey.value.voteMode === 'single') {
      selectedCandidateIds.value = isSelected(candidateId) ? [] : [candidateId]; return
    }
    if (isSelected(candidateId)) {
      selectedCandidateIds.value = selectedCandidateIds.value.filter((id) => id !== candidateId); return
    }
    if (selectedCandidateIds.value.length >= voteLimit.value) { message.warning(`最多选择 ${voteLimit.value} 项。`); return }
    selectedCandidateIds.value = [...selectedCandidateIds.value, candidateId]
  }

  const openVoteConfirm = async () => {
    if (survey.value.requireLogin && !currentUser.value) { startOAuthLogin('player'); return }
    if (!isSurveyAcceptingSubmissions(survey.value)) { message.warning(getSurveyAvailability(survey.value).message); return }
    if (currentVote.value && !survey.value.allowVoteEdits) { message.warning('你已经提交过本问卷，当前不允许修改。'); return }
    if (selectedCandidateIds.value.length === 0) { message.warning('请至少选择一个候选项。'); return }
    if (!survey.value.requireLogin && !currentUser.value && !guestDraft.gameId.trim()) {
      const confirmed = await requestGuestName()
      if (!confirmed || !guestDraft.gameId.trim()) return
    }
    voteConfirmOpen.value = true
  }

  const confirmSubmitVote = async () => {
    const valid = selectedCandidateIds.value.filter((id) => approvedCandidateIds.value.has(id))
    selectedCandidateIds.value = [...new Set(valid)]
    if (selectedCandidateIds.value.length === 0) return
    if (selectedCandidateIds.value.length > voteLimit.value) {
      message.warning(`最多选择 ${voteLimit.value} 项。`)
      return
    }
    const surveyId = survey.value.id
    const ts = new Date().toISOString()
    if (currentVote.value) {
      currentVote.value.history.push({ candidateIds: [...currentVote.value.candidateIds], changedAt: currentVote.value.updatedAt })
      currentVote.value.candidateIds = [...selectedCandidateIds.value]
      currentVote.value.updatedAt = ts
      addAudit('vote.updated', `${currentActorName()} 修改了「${survey.value.title}」的投票`, surveyId, currentActorName())
    } else {
      appState.value.votes.push({ id: createId('vote'), surveyId, userId: effectiveUserId.value, userName: currentActorName(), gameId: currentGameId(), candidateIds: [...selectedCandidateIds.value], createdAt: ts, updatedAt: ts, history: [] })
      addAudit('vote.created', `${currentActorName()} 提交了「${survey.value.title}」的投票`, surveyId, currentActorName())
    }
    if (!(await persist(surveyId))) return
    voteConfirmOpen.value = false
    submittedSurveyId.value = surveyId
    editingVote.value = false
  }

  const openCandidateModal = async () => {
    submissionMessage.value = ''
    if (survey.value.requireLogin && !currentUser.value) { startOAuthLogin('player'); return }
    if (!isSurveyAcceptingSubmissions(survey.value)) { message.warning(getSurveyAvailability(survey.value).message); return }
    if (!survey.value.requireLogin && !currentUser.value && !guestDraft.gameId.trim()) {
      const confirmed = await requestGuestName()
      if (!confirmed || !guestDraft.gameId.trim()) return
    }
    candidateModalOpen.value = true
  }

  const validateUrl = (value: string) => {
    if (!value.trim()) return true
    try { new URL(value); return true } catch { return false }
  }

  const submitCandidate = async () => {
    submissionMessage.value = ''
    if (!isSurveyAcceptingSubmissions(survey.value) || !survey.value.candidateSubmission.enabled) { submissionMessage.value = '当前问卷没有开放候选项投稿。'; return }
    for (const field of survey.value.candidateFields) {
      const val = submissionValues.value[field.key]?.trim() ?? ''
      if (field.required && !val) { submissionMessage.value = `请填写「${field.label}」。`; return }
      if (field.type === 'url' && !validateUrl(val)) { submissionMessage.value = `「${field.label}」需要是完整链接。`; return }
    }
    const normalize = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ')
    const title = submissionValues.value.packName?.trim() || submissionValues.value.name?.trim() || submissionValues.value.title?.trim() || survey.value.candidateFields.map((f) => submissionValues.value[f.key]).find(Boolean)?.trim() || '未命名候选项'
    if (appState.value.candidates.find((c) => c.surveyId === survey.value.id && c.status !== 'rejected' && normalize(c.title) === normalize(title))) { submissionMessage.value = '已经存在同名候选项。'; return }
    const ts = new Date().toISOString()
    const status: CandidateStatus = survey.value.candidateSubmission.requiresReview ? 'pending' : 'approved'
    appState.value.candidates.unshift({ id: createId('candidate'), surveyId: survey.value.id, title, status, fields: { ...submissionValues.value }, submitterUserId: effectiveUserId.value, submitterName: currentActorName(), createdAt: ts, reviewedAt: status === 'approved' ? ts : undefined, reviewerName: status === 'approved' ? 'Auto Review' : undefined })
    addAudit('candidate.submitted', `${currentActorName()} 投稿了「${title}」`, survey.value.id, currentActorName())
    if (!(await persist(survey.value.id))) return
    resetSubmissionValues()
    candidateModalOpen.value = false
    message.success(status === 'pending' ? '候选项已提交，等待管理员审核。' : '候选项已进入投票列表。')
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

  return {
    selectedCandidateIds,
    voteConfirmOpen,
    candidateModalOpen,
    submittedSurveyId,
    editingVote,
    submissionMessage,
    submissionValues,
    surveyCandidates,
    surveyVotes,
    approvedCandidates,
    approvedCandidateIds,
    voteLimit,
    currentVote,
    hasSubmittedCurrentSurvey,
    showSubmissionSummary,
    totalVoters,
    totalSelections,
    candidateCounts,
    selectedCandidates,
    isSelected,
    countForCandidate,
    percentForCandidate,
    pruneSelectionToApproved,
    clampSelectionToVoteLimit,
    syncSelectionFromVote,
    toggleCandidate,
    openVoteConfirm,
    confirmSubmitVote,
    openCandidateModal,
    submitCandidate,
    initSubmissionValues,
    resetSubmissionValues
  }
}
