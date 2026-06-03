<script setup lang="ts">
import { onMounted, watch } from 'vue'
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

const { survey, loadAppState } = useAppState()
const { isAdminRoute } = useRouter()
const { currentUser } = useAuth()
const { syncSelectionFromVote, initSubmissionValues, editingVote, voteConfirmOpen, candidateModalOpen, submittedSurveyId, submissionMessage } = useSurveyVote()
const { syncSurveySettingsDraft } = useAdminSurvey()
const { syncFieldDrafts } = useAdminFields()
const { initAdminCandidateValues } = useAdminCandidates()

onMounted(() => { void loadAppState() })

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
