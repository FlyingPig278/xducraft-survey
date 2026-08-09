import { computed, ref } from 'vue'
import type { Candidate } from '../types'
import { useAppState } from './useAppState'
import { useAuth } from './useAuth'
import { getSurveyAvailability, isSurveyAcceptingSubmissions } from './useSurveyAvailability'
import { surveyApi } from '../api'
import { safeHttpUrl } from '../utils/security'

const selectedCandidateIds = ref<string[]>([])
const voteConfirmOpen = ref(false)
const candidateModalOpen = ref(false)
const submittedSurveyId = ref('')
const editingVote = ref(false)
const submissionMessage = ref('')
const submissionValues = ref<Record<string, string>>({})

export function useSurveyVote() {
  const { appState, survey, applyRemoteState, message } = useAppState()
  const { currentUser, effectiveUserId, currentGameId, guestDraft, requestGuestName, startOAuthLogin } = useAuth()

  const surveyCandidates = computed(() => appState.value.candidates.filter((c) => c.surveyId === survey.value.id))
  const surveyVotes = computed(() => appState.value.votes.filter((v) => v.surveyId === survey.value.id))
  const surveyResults = computed(() => appState.value.results[survey.value.id])
  const candidateSortOrder = (candidate: Candidate) => Number.isFinite(candidate.sortOrder) ? candidate.sortOrder : Number.MAX_SAFE_INTEGER
  const approvedCandidates = computed(() => surveyCandidates.value
    .filter((c) => c.status === 'approved')
    .sort((a, b) => candidateSortOrder(a) - candidateSortOrder(b) || a.createdAt.localeCompare(b.createdAt))
  )
  const approvedCandidateIds = computed(() => new Set(approvedCandidates.value.map((c) => c.id)))
  const voteLimit = computed(() => survey.value.voteMode === 'single' ? 1 : Math.max(1, survey.value.maxVotes || 1))

  const currentVote = computed(() => {
    if (survey.value.requireLogin && !currentUser.value) return null
    return surveyVotes.value.find((v) => v.userId === effectiveUserId.value) ?? null
  })

  const hasSubmittedCurrentSurvey = computed(() => Boolean(currentVote.value) || submittedSurveyId.value === survey.value.id)
  const showSubmissionSummary = computed(() => hasSubmittedCurrentSurvey.value && !editingVote.value)

  const totalVoters = computed(() => surveyResults.value?.totalVoters ?? surveyVotes.value.length)
  const totalSelections = computed(() => surveyResults.value?.totalSelections ??
    surveyVotes.value.reduce((total, vote) => total + vote.candidateIds.length, 0))
  const candidateCounts = computed(() => {
    if (surveyResults.value) {
      return new Map(Object.entries(surveyResults.value.counts).map(([id, count]) => [id, Number(count)]))
    }
    const counts = new Map<string, number>()
    surveyVotes.value.forEach((vote) => {
      vote.candidateIds.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1))
    })
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
    try {
      applyRemoteState(await surveyApi.submitVote({
        surveyId,
        candidateIds: [...selectedCandidateIds.value],
        guestGameId: currentGameId()
      }), surveyId)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '投票提交失败')
      return
    }
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

  const submitCandidate = async () => {
    submissionMessage.value = ''
    if (!isSurveyAcceptingSubmissions(survey.value) || !survey.value.candidateSubmission.enabled) { submissionMessage.value = '当前问卷没有开放候选项投稿。'; return }
    for (const field of survey.value.candidateFields) {
      const val = submissionValues.value[field.key]?.trim() ?? ''
      if (field.required && !val) { submissionMessage.value = `请填写「${field.label}」。`; return }
      if (field.type === 'url' && val && !safeHttpUrl(val)) { submissionMessage.value = `「${field.label}」只接受 http 或 https 完整链接。`; return }
    }
    const normalize = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ')
    const title = submissionValues.value.packName?.trim() || submissionValues.value.name?.trim() || submissionValues.value.title?.trim() || survey.value.candidateFields.map((f) => submissionValues.value[f.key]).find(Boolean)?.trim() || '未命名候选项'
    if (appState.value.candidates.find((c) => c.surveyId === survey.value.id && c.status !== 'rejected' && normalize(c.title) === normalize(title))) { submissionMessage.value = '已经存在同名候选项。'; return }
    let status = survey.value.candidateSubmission.requiresReview ? 'pending' : 'approved'
    try {
      const result = await surveyApi.submitCandidate({
        surveyId: survey.value.id,
        fields: { ...submissionValues.value },
        guestGameId: currentGameId()
      })
      status = result.candidateStatus
      applyRemoteState(result.state, survey.value.id)
    } catch (error) {
      submissionMessage.value = error instanceof Error ? error.message : '候选项提交失败'
      return
    }
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
