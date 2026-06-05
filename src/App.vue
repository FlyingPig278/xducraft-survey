<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, watch } from 'vue'
import { NConfigProvider, zhCN, dateZhCN } from 'naive-ui'
import { useAppState } from './composables/useAppState'
import { useRouter } from './composables/useRouter'
import { useAuth } from './composables/useAuth'
import { useSurveyVote } from './composables/useSurveyVote'

const SurveyPage = defineAsyncComponent(() => import('./components/survey/SurveyPage.vue'))
const AdminShell = defineAsyncComponent(() => import('./components/admin/AdminShell.vue'))

const { survey, loadAppState, startRemoteSync, stopRemoteSync } = useAppState()
const { route, isAdminRoute } = useRouter()
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

const resetTransientSurveyUi = () => {
  submissionMessage.value = ''
  voteConfirmOpen.value = false
  candidateModalOpen.value = false
  editingVote.value = false
}

onMounted(async () => {
  await consumeAuthRedirect()
  await loadAppState()
  startRemoteSync()
})

onBeforeUnmount(stopRemoteSync)

watch(() => survey.value.id, () => {
  initSubmissionValues()
  syncSelectionFromVote()
  resetTransientSurveyUi()
}, { immediate: true })

watch(
  () => route.value.mode,
  (mode, previousMode) => {
    if (mode !== 'survey' || previousMode !== 'survey') resetTransientSurveyUi()
  }
)

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
  initSubmissionValues,
  { immediate: true }
)
</script>

<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN">
    <SurveyPage v-if="!isAdminRoute" />
    <AdminShell v-else />
  </n-config-provider>
</template>
