<script setup lang="ts">
import { computed } from 'vue'
import { NAlert, NButton, NCard, NEmpty, NResult, NSpace, NTag } from 'naive-ui'
import { LogIn, LogOut, Send, Settings2 } from '../../icons'
import { useAppState } from '../../composables/useAppState'
import { useAuth } from '../../composables/useAuth'
import { useRouter } from '../../composables/useRouter'
import { useSurveyVote } from '../../composables/useSurveyVote'
import { useAdminSurvey } from '../../composables/useAdminSurvey'
import { useCandidateFields, statusLabel, statusTagType } from '../../composables/useCandidateFields'
import { formatSurveyWindow, getSurveyAvailability } from '../../composables/useSurveyAvailability'
import CandidateCard from './CandidateCard.vue'
import ResultsView from './ResultsView.vue'
import VoteConfirmModal from './VoteConfirmModal.vue'
import CandidateSubmitModal from './CandidateSubmitModal.vue'
import GuestNameModal from './GuestNameModal.vue'

const { survey, apiLoading, apiError, surveyById } = useAppState()
const { currentUser, guestDraft, isAdmin, startOAuthLogin, logout } = useAuth()
const { route, navigateAdmin } = useRouter()
const {
  selectedCandidateIds, voteLimit, approvedCandidates,
  showSubmissionSummary, totalVoters, totalSelections,
  currentVote, editingVote, isSelected,
  countForCandidate, percentForCandidate,
  toggleCandidate, openVoteConfirm, openCandidateModal
} = useSurveyVote()
const { surveyGuideText } = useAdminSurvey()
const { candidateMetaFor, candidateIntro, candidatePackUrl, candidateVideoUrl, candidateCategory } = useCandidateFields(surveyById)

const publicSurveyMissing = computed(() =>
  route.value.mode === 'not-found' ||
  (route.value.mode === 'survey' && !apiLoading.value && !surveyById(route.value.surveyId))
)
const publicSurveyReady = computed(() =>
  route.value.mode === 'survey' && Boolean(surveyById(route.value.surveyId))
)
const canViewResultsBeforeVote = computed(() => survey.value.resultVisibility === 'always')
const canViewResultsAfterVote = computed(() =>
  survey.value.resultVisibility === 'always' ||
  (survey.value.resultVisibility === 'after_vote' && showSubmissionSummary.value)
)
const surveyAvailability = computed(() => getSurveyAvailability(survey.value))
const canSubmitSurvey = computed(() => surveyAvailability.value.canSubmit)
const availabilityAlertType = computed(() => surveyAvailability.value.reason === 'draft' || surveyAvailability.value.reason === 'not_started' ? 'info' : 'warning')

const surveyRuleHints = computed(() => {
  const hints: string[] = []
  const windowHint = formatSurveyWindow(survey.value)
  if (windowHint) hints.push(windowHint)
  if (survey.value.resultVisibility === 'after_vote') hints.push('投票后查看结果')
  if (survey.value.resultVisibility === 'hidden') hints.push('结果不公开')
  if (survey.value.allowVoteEdits) hints.push('提交后可修改')
  return hints
})

const customCandidateHint = computed(() =>
  survey.value.candidateSubmission.requiresReview ? '提交后进入审核，通过后可被投票' : '提交后直接加入投票列表'
)

const openAdminPanel = () => { navigateAdmin('surveys') }
</script>

<template>
  <main class="survey-page">
    <header class="survey-topbar">
      <span class="survey-topbar-brand">XDUCraft Vote</span>
      <n-space align="center" :size="12">
        <n-tag v-if="!survey.requireLogin && guestDraft.gameId.trim() && !currentUser" :bordered="false" size="small" round>
          以 {{ guestDraft.gameId }} 参与
        </n-tag>
        <template v-if="currentUser">
          <n-tag :bordered="false" size="small">{{ currentUser.displayName }}</n-tag>
          <n-button v-if="isAdmin" size="small" quaternary @click="openAdminPanel">
            <template #icon><Settings2 :size="14" /></template>
            管理后台
          </n-button>
          <n-button size="small" quaternary @click="logout">
            <template #icon><LogOut :size="14" /></template>
            退出
          </n-button>
        </template>
        <n-button v-else size="small" @click="startOAuthLogin('player')">
          <template #icon><LogIn :size="14" /></template>
          登录
        </n-button>
      </n-space>
    </header>

    <div class="survey-container">
      <n-alert v-if="apiError" type="error" :bordered="false" style="margin-bottom: 16px">
        API 连接失败：{{ apiError }}
      </n-alert>
      <n-alert v-else-if="apiLoading" type="info" :bordered="false" style="margin-bottom: 16px">
        正在同步问卷数据...
      </n-alert>

      <n-card v-if="publicSurveyMissing">
        <n-result status="404" title="未找到问卷" description="请通过管理员发布的公开链接或二维码进入问卷。" style="padding: 24px 0" />
      </n-card>

      <n-card v-else-if="publicSurveyReady">
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

        <n-alert v-if="!canSubmitSurvey" :type="availabilityAlertType" :bordered="false" style="margin-bottom: 16px">
          {{ surveyAvailability.message }}
        </n-alert>

        <p style="color: #64748b; margin: 0 0 10px; line-height: 1.6">{{ surveyGuideText }}</p>
        <div v-if="surveyRuleHints.length" class="survey-rule-hints">
          <span v-for="hint in surveyRuleHints" :key="hint">{{ hint }}</span>
        </div>

        <!-- Submitted view -->
        <template v-if="showSubmissionSummary">
          <n-result
            status="success"
            title="投票已提交"
            :description="canViewResultsAfterVote ? `${totalVoters} 名玩家已参与，共 ${totalSelections} 个选择` : '你的选择已记录，票数结果由管理员控制是否公开。'"
            style="padding: 16px 0"
          />
          <ResultsView />
          <n-space v-if="survey.allowVoteEdits && canSubmitSurvey" justify="end" style="margin-top: 18px">
            <n-button type="primary" @click="editingVote = true">修改投票</n-button>
          </n-space>
        </template>

        <!-- Voting view -->
        <template v-else>
          <n-space vertical :size="8">
            <n-empty v-if="approvedCandidates.length === 0" description="当前还没有已通过候选项" />
            <CandidateCard
              v-for="candidate in approvedCandidates"
              :key="candidate.id"
              :candidate="candidate"
              :selected="isSelected(candidate.id)"
              :meta="candidateMetaFor(candidate, survey)"
              :intro="candidateIntro(candidate)"
              :pack-url="candidatePackUrl(candidate)"
              :video-url="candidateVideoUrl(candidate)"
              :category="candidateCategory(candidate)"
              :show-stats="canViewResultsBeforeVote"
              :count="countForCandidate(candidate.id)"
              :percent="percentForCandidate(candidate.id)"
              @toggle="toggleCandidate(candidate.id)"
            />

            <div
              v-if="survey.candidateSubmission.enabled"
              class="candidate-card custom-card"
              :class="{ disabled: !canSubmitSurvey }"
              @click="openCandidateModal"
            >
              <div class="candidate-card-check candidate-card-plus">
                +
              </div>
              <div class="candidate-card-body">
                <div class="candidate-card-title">自定义候选项</div>
                <div class="candidate-card-meta">{{ customCandidateHint }}</div>
              </div>
            </div>
          </n-space>

          <div class="submit-footer">
            <n-tag :bordered="false" round>
              已选 {{ selectedCandidateIds.length }} / {{ voteLimit }}
            </n-tag>
            <n-button type="primary" :disabled="selectedCandidateIds.length === 0 || !canSubmitSurvey" @click="openVoteConfirm">
              <template #icon><Send :size="14" /></template>
              {{ currentVote ? '提交修改' : '提交投票' }}
            </n-button>
          </div>
        </template>
      </n-card>
    </div>

    <VoteConfirmModal />
    <CandidateSubmitModal />
    <GuestNameModal />
  </main>
</template>
