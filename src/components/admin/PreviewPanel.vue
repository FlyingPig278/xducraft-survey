<script setup lang="ts">
import { computed } from 'vue'
import { NCard, NEmpty, NButton, NSelect, NSpace, NTag } from 'naive-ui'
import { Send, Eye } from '../../icons'
import { useAppState } from '../../composables/useAppState'
import { useAdminSurvey } from '../../composables/useAdminSurvey'
import { useSurveyVote } from '../../composables/useSurveyVote'
import { useCandidateFields, statusLabel, statusTagType } from '../../composables/useCandidateFields'
import { publicSurveyUrlFor } from '../../composables/useRouter'
import CandidateCard from '../survey/CandidateCard.vue'

const { survey, adminSurveyId, surveys, surveyById } = useAppState()
const { surveyGuideText, publishSurvey } = useAdminSurvey()
const { approvedCandidates, voteLimit, countForCandidate, percentForCandidate } = useSurveyVote()
const { candidateMetaFor, candidateIntro, candidatePackUrl, candidateVideoUrl, candidateCategory } = useCandidateFields(surveyById)

const surveySelectOptions = computed(() => surveys.value.map((s) => ({ label: s.title, value: s.id })))
const canViewResultsBeforeVote = computed(() => survey.value.resultVisibility === 'always')
const customCandidateHint = computed(() => survey.value.candidateSubmission.requiresReview ? '提交后进入审核，通过后可被投票' : '提交后直接加入投票列表')

const surveyRuleHints = computed(() => {
  const resultHint = survey.value.resultVisibility === 'always' ? '提交前可查看票数' : survey.value.resultVisibility === 'after_vote' ? '投票后可查看票数' : '票数不向玩家公开'
  const editHint = survey.value.allowVoteEdits ? '提交后可修改' : '提交后不可修改'
  const identityHint = survey.value.requireLogin ? '需要登录提交' : '免登录填写'
  const hints = [resultHint, editHint, identityHint]
  if (survey.value.candidateSubmission.enabled) hints.push(customCandidateHint.value)
  return hints
})

const openPublicSurvey = () => {
  window.open(publicSurveyUrlFor(adminSurveyId.value), '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <div class="admin-section-header">
    <div>
      <h1>发布预览</h1>
      <p>预览玩家通过公开链接打开时看到的答题页。</p>
    </div>
    <div class="admin-section-header-actions">
      <n-select v-model:value="adminSurveyId" :options="surveySelectOptions" style="width: 240px" />
      <n-button v-if="survey.status !== 'open'" @click="publishSurvey">
        <template #icon><Send :size="14" /></template>
        发布问卷
      </n-button>
      <n-button type="primary" @click="openPublicSurvey">
        <template #icon><Eye :size="14" /></template>
        新窗口打开
      </n-button>
    </div>
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
        <p style="color: #64748b; margin: 0 0 10px; line-height: 1.6">{{ surveyGuideText }}</p>
        <div class="survey-rule-hints">
          <span v-for="hint in surveyRuleHints" :key="hint">{{ hint }}</span>
        </div>
        <n-space vertical :size="8">
          <n-empty v-if="approvedCandidates.length === 0" description="当前还没有已通过候选项" />
          <CandidateCard
            v-for="c in approvedCandidates"
            :key="c.id"
            :candidate="c"
            :selected="false"
            :meta="candidateMetaFor(c, survey)"
            :intro="candidateIntro(c)"
            :pack-url="candidatePackUrl(c)"
            :video-url="candidateVideoUrl(c)"
            :category="candidateCategory(c)"
            :show-stats="canViewResultsBeforeVote"
            :count="countForCandidate(c.id)"
            :percent="percentForCandidate(c.id)"
            :preview="true"
          />
          <div class="candidate-card custom-card" style="cursor: default">
            <div class="candidate-card-check" style="border-color: #c7d2fe; display: grid; place-items: center">
              <span style="color: #6366f1; font-size: 18px; font-weight: 700">+</span>
            </div>
            <div class="candidate-card-body">
              <div class="candidate-card-title">自定义候选项</div>
              <div class="candidate-card-meta">{{ customCandidateHint }}</div>
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
