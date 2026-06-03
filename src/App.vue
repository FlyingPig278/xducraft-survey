<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { NConfigProvider, zhCN, dateZhCN } from 'naive-ui'
import { useAppState } from './composables/useAppState'
import { useRouter } from './composables/useRouter'
import { useAuth } from './composables/useAuth'
import { useSurveyVote } from './composables/useSurveyVote'
import { useAdminSurvey } from './composables/useAdminSurvey'
import { useAdminFields } from './composables/useAdminFields'
import { useAdminCandidates } from './composables/useAdminCandidates'
import SurveyPage from './components/survey/SurveyPage.vue'
import AdminShell from './components/admin/AdminShell.vue'

const { survey, loadAppState, startRemoteSync, stopRemoteSync } = useAppState()
const { isAdminRoute } = useRouter()
const { currentUser, consumeAuthRedirect } = useAuth()
const {
  syncSelectionFromVote,
  pruneSelectionToApproved,
  clampSelectionToVoteLimit,
  initSubmissionValues,
  approvedCandidates,
  currentVote,
  editingVote,
  voteConfirmOpen,
  candidateModalOpen,
  submissionMessage
} = useSurveyVote()
const { syncSurveySettingsDraft } = useAdminSurvey()
const { syncFieldDrafts } = useAdminFields()
const { initAdminCandidateValues } = useAdminCandidates()

onMounted(async () => {
  await consumeAuthRedirect()
  await loadAppState()
  startRemoteSync()
})

onBeforeUnmount(stopRemoteSync)

watch(() => survey.value.id, () => {
  syncSurveySettingsDraft()
  syncFieldDrafts()
  initSubmissionValues()
  initAdminCandidateValues()
  syncSelectionFromVote()
  submissionMessage.value = ''
  voteConfirmOpen.value = false
  candidateModalOpen.value = false
  editingVote.value = false
}, { immediate: true })

watch(currentUser, syncSelectionFromVote, { immediate: true })

watch(
  () => currentVote.value
    ? `${survey.value.id}:${currentVote.value.updatedAt}:${currentVote.value.candidateIds.join(',')}`
    : `${survey.value.id}:no-current-vote`,
  syncSelectionFromVote,
  { immediate: true }
)

watch(
  () => `${survey.value.id}:${approvedCandidates.value.map((c) => c.id).join('|')}`,
  pruneSelectionToApproved,
  { immediate: true }
)

watch(
  () => `${survey.value.id}:${survey.value.voteMode}:${survey.value.maxVotes}`,
  clampSelectionToVoteLimit,
  { immediate: true }
)

watch(
  () => `${survey.value.id}:${survey.value.candidateFields.map((f) => `${f.id}:${f.key}`).join('|')}`,
  () => { initSubmissionValues(); initAdminCandidateValues() },
  { immediate: true }
)
</script>

<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN">
    <SurveyPage v-if="!isAdminRoute" />
    <AdminShell v-else />
  </n-config-provider>
</template>
