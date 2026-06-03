<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NCard, NSelect, NSpace, NTag } from 'naive-ui'
import { Eye, Plus, RotateCcw, Settings2 } from '../../icons'
import { useAppState } from '../../composables/useAppState'
import { useAdminSurvey } from '../../composables/useAdminSurvey'
import { navigateAdmin, publicSurveyUrlFor } from '../../composables/useRouter'
import { statusLabel, statusTagType } from '../../composables/useCandidateFields'
import type { SurveyStatus } from '../../types'

type SurveyFilter = 'all' | SurveyStatus

const { appState, adminSurveyId, surveys, resetDemo } = useAppState()
const { surveyCreateModalOpen, updateSurveyStatus } = useAdminSurvey()
const statusFilter = ref<SurveyFilter>('all')

const filterOptions = [
  { label: '全部问卷', value: 'all' },
  { label: '已发布', value: 'open' },
  { label: '草稿/未发布', value: 'draft' },
  { label: '已关闭', value: 'closed' }
]
const statusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '开放', value: 'open' },
  { label: '关闭', value: 'closed' }
]

const surveyRows = computed(() => surveys.value
  .filter((item) => statusFilter.value === 'all' || item.status === statusFilter.value)
  .map((item) => {
    const votes = appState.value.votes.filter((vote) => vote.surveyId === item.id)
    const candidates = appState.value.candidates.filter((candidate) => candidate.surveyId === item.id)
    return {
      item,
      voters: votes.length,
      selections: votes.reduce((sum, vote) => sum + vote.candidateIds.length, 0),
      candidates: candidates.length
    }
  }))

const openPublicSurvey = (surveyId: string) => {
  window.open(publicSurveyUrlFor(surveyId), '_blank', 'noopener,noreferrer')
}

const openSettings = (surveyId: string) => {
  adminSurveyId.value = surveyId
  navigateAdmin('settings', surveyId)
}

const changeSurveyStatus = (surveyId: string, value: SurveyStatus) => {
  void updateSurveyStatus(surveyId, value)
}
</script>

<template>
  <div class="admin-section-header">
    <div>
      <h1>问卷列表</h1>
      <p>查看所有问卷状态和基础数据，进入设置后再编辑规则与发布物料。</p>
    </div>
    <div class="admin-section-header-actions">
      <n-select v-model:value="statusFilter" :options="filterOptions" size="small" style="width: 132px" />
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
        @click="openSettings(row.item.id)"
      >
        <span class="survey-list-main">
          <span class="survey-list-title">{{ row.item.title }}</span>
          <span class="survey-list-meta">
            <n-tag :type="statusTagType(row.item.status)" size="small" round>{{ statusLabel(row.item.status) }}</n-tag>
            <span>{{ row.voters }} 人参与</span>
            <span>{{ row.selections }} 次选择</span>
            <span>{{ row.candidates }} 个候选</span>
            <span>{{ row.item.voteMode === 'single' ? '单选' : `最多 ${row.item.maxVotes} 项` }}</span>
          </span>
        </span>
        <span class="survey-list-actions">
          <n-select
            :value="row.item.status"
            :options="statusOptions"
            size="tiny"
            style="width: 92px"
            @click.stop
            @update:value="(value) => changeSurveyStatus(row.item.id, value)"
          />
          <n-button size="tiny" secondary @click.stop="openSettings(row.item.id)">
            <template #icon><Settings2 :size="13" /></template>
            设置
          </n-button>
          <n-button size="tiny" secondary @click.stop="openPublicSurvey(row.item.id)">
            <template #icon><Eye :size="13" /></template>
            预览
          </n-button>
        </span>
      </div>
    </div>

    <n-space v-if="surveyRows.length === 0" justify="center" style="padding: 36px 0; color: #64748b">
      当前筛选下没有问卷。
    </n-space>
  </n-card>
</template>
