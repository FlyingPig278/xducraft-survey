<script setup lang="ts">
import { computed } from 'vue'
import { NCard, NForm, NFormItem, NInput, NInputNumber, NSelect, NSpace, NSwitch, NButton, NAlert, NTag } from 'naive-ui'
import { Plus, Save, Copy, Eye, Settings2, RotateCcw } from '../../icons'
import { useAppState } from '../../composables/useAppState'
import { useAdminSurvey } from '../../composables/useAdminSurvey'
import { navigateAdmin, publicSurveyUrlFor } from '../../composables/useRouter'
import { statusLabel, statusTagType } from '../../composables/useCandidateFields'

const { appState, survey, adminSurveyId, surveys, resetDemo } = useAppState()
const {
  surveySettingsDraft, surveyCreateModalOpen,
  surveySettingsDirty, surveyHasVotes,
  saveSurveySettings
} = useAdminSurvey()

const surveySelectOptions = computed(() => surveys.value.map((s) => ({ label: s.title, value: s.id })))
const voteModeOptions = [{ label: '单选', value: 'single' }, { label: '多选', value: 'multiple' }]
const statusOptions = [{ label: '草稿', value: 'draft' }, { label: '开放', value: 'open' }, { label: '已关闭', value: 'closed' }]
const resultVisibilityOptions = [
  { label: '投票前后均显示', value: 'always' },
  { label: '投票后显示', value: 'after_vote' },
  { label: '不对玩家显示', value: 'hidden' }
]

const publicSurveyUrl = computed(() => publicSurveyUrlFor(survey.value.id))
const publicSurveyQrUrl = computed(() => `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(publicSurveyUrl.value)}`)
const surveyRows = computed(() => surveys.value.map((item) => {
  const votes = appState.value.votes.filter((vote) => vote.surveyId === item.id).length
  const candidates = appState.value.candidates.filter((candidate) => candidate.surveyId === item.id).length
  return { item, votes, candidates }
}))

const copyPublicLink = async () => {
  try { await navigator.clipboard.writeText(publicSurveyUrl.value) } catch { /* noop */ }
}

const openPreview = async () => {
  if (surveySettingsDirty.value) await saveSurveySettings('问卷设置已保存')
  navigateAdmin('preview', adminSurveyId.value)
}

const selectSurvey = (surveyId: string) => {
  adminSurveyId.value = surveyId
}
</script>

<template>
  <div class="admin-section-header">
    <div>
      <h1>问卷管理</h1>
      <p>配置投票规则，并发布独立链接或二维码。</p>
    </div>
    <div class="admin-section-header-actions">
      <n-button @click="surveyCreateModalOpen = true">
        <template #icon><Plus :size="14" /></template>
        新建问卷
      </n-button>
      <n-button quaternary @click="resetDemo">
        <template #icon><RotateCcw :size="14" /></template>
        重置演示
      </n-button>
    </div>
  </div>

  <n-card size="small">
    <div class="survey-list">
      <div
        v-for="row in surveyRows"
        :key="row.item.id"
        class="survey-list-item"
        :class="{ active: row.item.id === adminSurveyId }"
        @click="selectSurvey(row.item.id)"
      >
        <span class="survey-list-main">
          <span class="survey-list-title">{{ row.item.title }}</span>
          <span class="survey-list-meta">
            <n-tag :type="statusTagType(row.item.status)" size="small" round>{{ statusLabel(row.item.status) }}</n-tag>
            <span>{{ row.votes }} 票</span>
            <span>{{ row.candidates }} 候选</span>
            <span>{{ row.item.voteMode === 'single' ? '单选' : `最多 ${row.item.maxVotes} 项` }}</span>
          </span>
        </span>
        <span class="survey-list-actions">
          <n-button size="tiny" secondary @click.stop="navigateAdmin('fields', row.item.id)">字段</n-button>
          <n-button size="tiny" secondary @click.stop="navigateAdmin('preview', row.item.id)">预览</n-button>
        </span>
      </div>
    </div>

    <n-form label-placement="top" :show-feedback="false">
      <n-form-item label="选择问卷">
        <n-select v-model:value="adminSurveyId" :options="surveySelectOptions" />
      </n-form-item>
      <n-form-item label="标题">
        <n-input v-model:value="surveySettingsDraft.title" />
      </n-form-item>
      <n-form-item label="状态">
        <n-select v-model:value="surveySettingsDraft.status" :options="statusOptions" />
      </n-form-item>
      <n-form-item label="说明">
        <n-input v-model:value="surveySettingsDraft.description" type="textarea" :rows="2" />
      </n-form-item>
      <n-form-item label="答题指引">
        <n-input v-model:value="surveySettingsDraft.guideText" type="textarea" :rows="2" />
      </n-form-item>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
        <n-form-item label="模式">
          <n-select v-model:value="surveySettingsDraft.voteMode" :options="voteModeOptions" />
        </n-form-item>
        <n-form-item label="最多项数">
          <n-input-number v-model:value="surveySettingsDraft.maxVotes" :min="1" style="width: 100%" />
        </n-form-item>
      </div>
      <n-form-item label="票数显示">
        <n-select v-model:value="surveySettingsDraft.resultVisibility" :options="resultVisibilityOptions" />
      </n-form-item>
      <n-space vertical :size="10" style="margin: 4px 0 16px">
        <n-space align="center" :size="8"><n-switch v-model:value="surveySettingsDraft.requireLogin" size="small" /><span>强制要求登录</span></n-space>
        <n-space align="center" :size="8"><n-switch v-model:value="surveySettingsDraft.allowVoteEdits" size="small" /><span>允许投票后修改</span></n-space>
        <n-space align="center" :size="8"><n-switch v-model:value="surveySettingsDraft.candidateSubmissionEnabled" size="small" /><span>开放自定义候选项</span></n-space>
        <n-space align="center" :size="8"><n-switch v-model:value="surveySettingsDraft.candidateSubmissionRequiresReview" size="small" /><span>候选项需要审核</span></n-space>
      </n-space>

      <n-alert v-if="surveyHasVotes" type="info" :bordered="false" style="margin-bottom: 16px">
        该问卷已有投票。修改规则会影响之后的提交。
      </n-alert>

      <n-space justify="space-between" align="center" style="margin-bottom: 16px">
        <n-tag :type="surveySettingsDirty ? 'warning' : 'success'" :bordered="false">
          {{ surveySettingsDirty ? '有未保存设置' : '设置已保存' }}
        </n-tag>
        <n-space :size="8">
          <n-button @click="navigateAdmin('fields')">
            <template #icon><Settings2 :size="14" /></template>
            配置字段
          </n-button>
          <n-button @click="openPreview">
            <template #icon><Eye :size="14" /></template>
            发布预览
          </n-button>
          <n-button type="primary" :disabled="!surveySettingsDirty" @click="saveSurveySettings()">
            <template #icon><Save :size="14" /></template>
            保存设置
          </n-button>
        </n-space>
      </n-space>

      <div class="share-section">
        <strong>发布链接</strong>
        <code>{{ publicSurveyUrl }}</code>
        <n-space :size="8">
          <n-button size="small" @click="copyPublicLink">
            <template #icon><Copy :size="14" /></template>
            复制链接
          </n-button>
        </n-space>
        <img :src="publicSurveyQrUrl" alt="问卷二维码" />
      </div>
    </n-form>
  </n-card>
</template>
