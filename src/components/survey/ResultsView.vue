<script setup lang="ts">
import { computed } from 'vue'
import { NSpace, NProgress, NPopover, NAlert } from 'naive-ui'
import { Info, Download, CirclePlay } from '../../icons'
import type { Candidate } from '../../types'
import { useAppState } from '../../composables/useAppState'
import { useSurveyVote } from '../../composables/useSurveyVote'
import { useCandidateFields } from '../../composables/useCandidateFields'

const { survey, surveyById } = useAppState()
const { approvedCandidates, totalVoters, candidateCounts } = useSurveyVote()
const { candidateMetaFor, candidateIntro, candidatePackUrl, candidateVideoUrl } = useCandidateFields(surveyById)

interface ResultRow {
  candidate: Candidate
  count: number
  percent: number
}

const resultRows = computed<ResultRow[]>(() =>
  approvedCandidates.value
    .map((c) => {
      const count = candidateCounts.value.get(c.id) ?? 0
      const percent = totalVoters.value > 0 ? Math.round((count / totalVoters.value) * 100) : 0
      return { candidate: c, count, percent }
    })
    .sort((a, b) => b.count - a.count || a.candidate.title.localeCompare(b.candidate.title))
)

const canViewResults = computed(() =>
  survey.value.resultVisibility === 'always' || survey.value.resultVisibility === 'after_vote'
)

const openExternal = (url: string) => { window.open(url, '_blank', 'noopener,noreferrer') }

const rankClass = (idx: number) => {
  if (idx === 0) return 'result-rank top-1'
  if (idx === 1) return 'result-rank top-2'
  if (idx === 2) return 'result-rank top-3'
  return 'result-rank'
}
</script>

<template>
  <template v-if="canViewResults">
    <n-space vertical :size="8">
      <div v-for="(row, idx) in resultRows" :key="row.candidate.id" class="result-item">
        <div class="result-item-info" style="display: flex; align-items: center; gap: 10px">
          <span :class="rankClass(idx)">{{ idx + 1 }}</span>
          <div style="min-width: 0; flex: 1">
            <div class="candidate-card-title-row">
              <div class="result-item-title">{{ row.candidate.title }}</div>
              <n-popover v-if="candidateIntro(row.candidate)" trigger="hover" placement="top" style="max-width: 320px">
                <template #trigger>
                  <button class="candidate-icon-btn" type="button" title="查看介绍" aria-label="查看介绍" @click.stop>
                    <Info :size="15" :stroke-width="2" aria-hidden="true" />
                  </button>
                </template>
                <div class="candidate-intro">{{ candidateIntro(row.candidate) }}</div>
              </n-popover>
              <span v-if="candidatePackUrl(row.candidate) || candidateVideoUrl(row.candidate)" class="candidate-card-actions">
                <button v-if="candidatePackUrl(row.candidate)" class="candidate-icon-btn" type="button" title="打开整合包链接" aria-label="打开整合包链接" @click="openExternal(candidatePackUrl(row.candidate))">
                  <Download :size="15" :stroke-width="2" aria-hidden="true" />
                </button>
                <button v-if="candidateVideoUrl(row.candidate)" class="candidate-icon-btn" type="button" title="打开宣传视频" aria-label="打开宣传视频" @click="openExternal(candidateVideoUrl(row.candidate))">
                  <CirclePlay :size="15" :stroke-width="2" aria-hidden="true" />
                </button>
              </span>
            </div>
            <div class="result-item-meta">{{ candidateMetaFor(row.candidate) || '未填写补充信息' }}</div>
            <n-progress :percentage="row.percent" :show-indicator="false" :height="6" style="margin-top: 8px" color="#6366f1" rail-color="#e2e8f0" />
          </div>
        </div>
        <div class="result-item-count">{{ row.count }} 票 <span style="color: #94a3b8; font-weight: 400; font-size: 13px">({{ row.percent }}%)</span></div>
      </div>
    </n-space>
  </template>
  <n-alert v-else type="info" :bordered="false">
    本问卷未公开实时票数。管理员仍可在后台留档和导出完整结果。
  </n-alert>
</template>
