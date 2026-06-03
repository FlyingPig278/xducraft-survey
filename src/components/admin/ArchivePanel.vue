<script setup lang="ts">
import { computed } from 'vue'
import { NCard, NSelect, NButton, NSpace, NStatistic, NEmpty, NAlert } from 'naive-ui'
import { FileDown } from '../../icons'
import { useAppState } from '../../composables/useAppState'
import { useExport } from '../../composables/useExport'
import { formatDate } from '../../composables/useCandidateFields'

const { adminSurveyId, surveys } = useAppState()
const { latestVote, currentSurveyAuditLogs, totalVoters, totalSelections, approvedCandidates, surveyVotes, exportResultsCsv, exportVotesCsv, exportJson } = useExport()

const surveySelectOptions = computed(() => surveys.value.map((s) => ({ label: s.title, value: s.id })))
const hasSurveys = computed(() => surveys.value.length > 0)
</script>

<template>
  <div class="admin-section-header">
    <div>
      <h1>数据留档</h1>
      <p>导出当前问卷的候选项、投票记录和完整 JSON。</p>
    </div>
    <div class="admin-section-header-actions">
      <n-select v-model:value="adminSurveyId" :options="surveySelectOptions" :disabled="!hasSurveys" style="width: 240px" />
      <n-button size="small" :disabled="!hasSurveys" @click="exportResultsCsv">
        <template #icon><FileDown :size="14" /></template>
        候选 CSV
      </n-button>
      <n-button size="small" :disabled="!hasSurveys" @click="exportVotesCsv">
        <template #icon><FileDown :size="14" /></template>
        投票 CSV
      </n-button>
      <n-button size="small" :disabled="!hasSurveys" @click="exportJson">
        <template #icon><FileDown :size="14" /></template>
        JSON
      </n-button>
    </div>
  </div>

  <n-alert v-if="!hasSurveys" type="info" :bordered="false">
    还没有问卷。请先在问卷列表中新建问卷。
  </n-alert>

  <div v-else class="stats-grid">
    <n-card size="small">
      <n-statistic label="参与人数" :value="totalVoters" />
    </n-card>
    <n-card size="small">
      <n-statistic label="总选择数" :value="totalSelections" />
    </n-card>
    <n-card size="small">
      <n-statistic label="候选项数" :value="approvedCandidates.length" />
    </n-card>
  </div>

  <div v-if="hasSurveys" class="archive-grid">
    <n-card title="投票记录" size="small">
      <n-empty v-if="surveyVotes.length === 0" description="暂无投票记录" />
      <n-space v-else vertical :size="6">
        <div v-for="v in surveyVotes" :key="v.id" class="archive-item">
          <strong>{{ v.userName }}</strong>
          <span>{{ v.candidateIds.length }} 项 / {{ formatDate(v.updatedAt) }}</span>
        </div>
      </n-space>
    </n-card>
    <n-card title="操作日志" size="small">
      <n-empty v-if="currentSurveyAuditLogs.length === 0" description="当前问卷暂无日志" />
      <n-space v-else vertical :size="6">
        <div v-for="log in currentSurveyAuditLogs.slice(0, 15)" :key="log.id" class="archive-item">
          <strong style="font-size: 13px">{{ log.action }}</strong>
          <span>{{ log.detail }}</span>
        </div>
      </n-space>
    </n-card>
  </div>

  <n-alert v-if="latestVote" type="info" :bordered="false" style="margin-top: 16px">
    最近投票更新：{{ latestVote.userName }} / {{ formatDate(latestVote.updatedAt) }}
  </n-alert>
</template>
