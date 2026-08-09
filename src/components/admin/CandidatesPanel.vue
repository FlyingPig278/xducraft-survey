<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  NCard, NForm, NFormItem, NInput, NSelect, NSpace, NButton,
  NAlert, NTag, NEmpty, NModal, NPopconfirm
} from 'naive-ui'
import { Check, X, Undo2, Pencil, ChevronUp, ChevronDown, Trash2, User } from '../../icons'
import { useAppState } from '../../composables/useAppState'
import { useAdminCandidates } from '../../composables/useAdminCandidates'
import { useCandidateFields, fieldSelectOptions, statusLabel, statusTagType, formatDate } from '../../composables/useCandidateFields'
import type { Candidate, VoteRecord } from '../../types'

interface CandidateVoterRow {
  id: string
  userName: string
  gameId: string
  recordedAt: string
}

const { appState, survey, adminSurveyId, surveys, surveyById, surveyTitleById } = useAppState()
const {
  candidateFilter, reviewNotes, adminCandidateValues,
  editCandidateValues, editCandidateModalOpen,
  adminCandidateRows, editingCandidate, editingCandidateSurvey, editingCandidateFields,
  initAdminCandidateValues, resetAdminCandidateValues,
  createAdminCandidate, openEditCandidate, saveCandidateEdit, setCandidateStatus,
  deleteCandidate, candidateHasVoteRecords, canMoveCandidate, moveCandidate
} = useAdminCandidates()
const { candidateReviewFields } = useCandidateFields(surveyById)

const surveySelectOptions = computed(() => surveys.value.map((s) => ({ label: s.title, value: s.id })))
const hasSurveys = computed(() => surveys.value.length > 0)
const voteDetailModalOpen = ref(false)
const voteDetailCandidateId = ref('')

const voteDetailCandidate = computed(() =>
  appState.value.candidates.find((candidate) => candidate.id === voteDetailCandidateId.value) ?? null
)

const latestTime = (values: string[]) =>
  values.filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? ''

const voterRowFor = (vote: VoteRecord, recordedAt: string): CandidateVoterRow => ({
  id: vote.id,
  userName: vote.userName || '匿名玩家',
  gameId: vote.gameId || '未记录游戏昵称',
  recordedAt
})

const candidateCurrentVoteCount = (candidateId: string) =>
  appState.value.votes.filter((vote) => vote.candidateIds.includes(candidateId)).length

const candidateVoteDetail = computed(() => {
  const candidate = voteDetailCandidate.value
  if (!candidate) return { current: [] as CandidateVoterRow[], former: [] as CandidateVoterRow[] }

  const current: CandidateVoterRow[] = []
  const former: CandidateVoterRow[] = []
  const votes = appState.value.votes.filter((vote) => vote.surveyId === candidate.surveyId)

  votes.forEach((vote) => {
    const currentSelected = vote.candidateIds.includes(candidate.id)
    const selectedHistoryTimes = (vote.history ?? [])
      .filter((snapshot) => snapshot.candidateIds.includes(candidate.id))
      .map((snapshot) => snapshot.changedAt)

    if (currentSelected) {
      current.push(voterRowFor(vote, vote.updatedAt || vote.createdAt))
      return
    }

    if (selectedHistoryTimes.length > 0) {
      former.push(voterRowFor(vote, latestTime(selectedHistoryTimes) || vote.updatedAt || vote.createdAt))
    }
  })

  const sortByRecordedAt = (rows: CandidateVoterRow[]) =>
    rows.sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))

  return { current: sortByRecordedAt(current), former: sortByRecordedAt(former) }
})

const openVoteDetail = (candidate: Candidate) => {
  voteDetailCandidateId.value = candidate.id
  voteDetailModalOpen.value = true
}
</script>

<template>
  <div class="admin-section-header">
    <div>
      <h1>候选审核</h1>
      <p>处理所有问卷里的玩家投稿，不受当前问卷选择影响。</p>
    </div>
    <div class="admin-section-header-actions">
      <n-button :type="candidateFilter === 'pending' ? 'primary' : 'default'" size="small" @click="candidateFilter = 'pending'">待审核</n-button>
      <n-button :type="candidateFilter === 'approved' ? 'primary' : 'default'" size="small" @click="candidateFilter = 'approved'">已通过</n-button>
      <n-button :type="candidateFilter === 'rejected' ? 'primary' : 'default'" size="small" @click="candidateFilter = 'rejected'">已拒绝</n-button>
      <n-button :type="candidateFilter === 'all' ? 'primary' : 'default'" size="small" @click="candidateFilter = 'all'">全部</n-button>
    </div>
  </div>

  <n-card title="添加当前问卷候选项" size="small" style="margin-bottom: 16px">
    <template #header-extra>
      <n-select v-model:value="adminSurveyId" :options="surveySelectOptions" :disabled="!hasSurveys" style="width: 240px" />
    </template>
    <n-alert v-if="!hasSurveys" type="info" :bordered="false">
      还没有问卷。请先在问卷列表中新建问卷。
    </n-alert>
    <n-alert v-else-if="survey.candidateFields.length === 0" type="warning" :bordered="false">
      当前问卷还没有候选项投稿字段，请先到字段配置中添加字段。
    </n-alert>
    <template v-else>
      <n-form label-placement="top" :show-feedback="false">
        <div class="modal-form-grid">
          <n-form-item
            v-for="field in survey.candidateFields"
            :key="field.id"
            :label="`${field.label}${field.required ? ' *' : ''}`"
            :class="{ 'modal-form-full': field.type === 'textarea' }"
          >
            <n-select
              v-if="field.type === 'select'"
              v-model:value="adminCandidateValues[field.key]"
              :options="fieldSelectOptions(field)"
              placeholder="请选择"
            />
            <n-input
              v-else-if="field.type === 'textarea'"
              v-model:value="adminCandidateValues[field.key]"
              type="textarea"
              :rows="3"
              :placeholder="field.placeholder"
            />
            <n-input
              v-else
              v-model:value="adminCandidateValues[field.key]"
              :placeholder="field.placeholder"
            />
          </n-form-item>
        </div>
        <n-space justify="end" style="margin-top: 16px" :size="12">
          <n-button @click="resetAdminCandidateValues">重置</n-button>
          <n-button type="primary" @click="createAdminCandidate">添加为已通过候选项</n-button>
        </n-space>
      </n-form>
    </template>
  </n-card>

  <n-empty v-if="adminCandidateRows.length === 0" description="当前筛选下没有候选项" />
  <n-space v-else vertical :size="12">
    <div v-for="c in adminCandidateRows" :key="c.id" class="review-card">
      <div class="review-card-header">
        <n-space align="center" :size="8">
          <strong style="font-size: 16px">{{ c.title }}</strong>
          <n-tag type="info" size="small" :bordered="false">{{ surveyTitleById(c.surveyId) }}</n-tag>
          <n-tag :type="statusTagType(c.status)" size="small" round>{{ statusLabel(c.status) }}</n-tag>
        </n-space>
        <span style="color: #94a3b8; font-size: 13px">{{ c.submitterName }} / {{ formatDate(c.createdAt) }}</span>
      </div>
      <div class="review-card-fields">
        <dl v-for="field in candidateReviewFields(c)" :key="field.key" class="review-card-field">
          <dt>{{ field.label }}</dt>
          <dd>{{ field.value || '未填' }}</dd>
        </dl>
      </div>
      <n-form-item label="审核备注" :show-feedback="false" style="margin-bottom: 12px">
        <n-input v-model:value="reviewNotes[c.id]" type="textarea" :rows="2" :placeholder="c.reviewNote || '审核备注'" />
      </n-form-item>
      <n-space :size="8">
        <n-button size="small" :disabled="!canMoveCandidate(c, -1)" @click="moveCandidate(c, -1)">
          <template #icon><ChevronUp :size="14" /></template>
          上移
        </n-button>
        <n-button size="small" :disabled="!canMoveCandidate(c, 1)" @click="moveCandidate(c, 1)">
          <template #icon><ChevronDown :size="14" /></template>
          下移
        </n-button>
        <n-button size="small" @click="openEditCandidate(c)">
          <template #icon><Pencil :size="14" /></template>
          编辑
        </n-button>
        <n-button size="small" @click="openVoteDetail(c)">
          <template #icon><User :size="14" /></template>
          投票明细 {{ candidateCurrentVoteCount(c.id) }}
        </n-button>
        <n-button v-if="c.status !== 'approved'" type="primary" size="small" @click="setCandidateStatus(c, 'approved')">
          <template #icon><Check :size="14" /></template>
          通过
        </n-button>
        <n-button v-if="c.status !== 'pending'" size="small" @click="setCandidateStatus(c, 'pending')">
          <template #icon><Undo2 :size="14" /></template>
          退回待审
        </n-button>
        <n-button v-if="c.status !== 'rejected'" type="error" size="small" @click="setCandidateStatus(c, 'rejected')">
          <template #icon><X :size="14" /></template>
          拒绝
        </n-button>
        <n-popconfirm
          v-if="!candidateHasVoteRecords(c)"
          positive-text="删除"
          negative-text="取消"
          @positive-click="deleteCandidate(c)"
        >
          <template #trigger>
            <n-button type="error" size="small" secondary>
              <template #icon><Trash2 :size="14" /></template>
              删除
            </n-button>
          </template>
          删除未产生投票记录的候选项。
        </n-popconfirm>
        <n-tag v-else size="small" :bordered="false">已有投票，仅可拒绝</n-tag>
      </n-space>
    </div>
  </n-space>

  <!-- Candidate vote detail modal -->
  <n-modal
    v-model:show="voteDetailModalOpen"
    preset="card"
    :title="voteDetailCandidate ? `投票明细：${voteDetailCandidate.title}` : '投票明细'"
    style="width: 760px; max-width: 95vw"
    :bordered="true"
  >
    <template #header-extra>
      <n-tag v-if="voteDetailCandidate" :bordered="false" size="small">
        {{ surveyTitleById(voteDetailCandidate.surveyId) }}
      </n-tag>
    </template>

    <n-alert v-if="!voteDetailCandidate" type="warning" :bordered="false">
      候选项不存在或已被移除。
    </n-alert>
    <template v-else>
      <div class="candidate-vote-summary">
        <n-tag type="success" :bordered="false" round>当前 {{ candidateVoteDetail.current.length }} 人</n-tag>
        <n-tag type="info" :bordered="false" round>曾经 {{ candidateVoteDetail.former.length }} 人</n-tag>
      </div>

      <div class="candidate-vote-detail-grid">
        <n-card size="small" title="当前仍选择">
          <n-empty v-if="candidateVoteDetail.current.length === 0" description="暂无当前选择者" />
          <n-space v-else vertical :size="6">
            <div v-for="row in candidateVoteDetail.current" :key="row.id" class="candidate-voter-row">
              <strong>{{ row.userName }}</strong>
              <span>{{ row.gameId }}</span>
              <small>{{ formatDate(row.recordedAt) }}</small>
            </div>
          </n-space>
        </n-card>

        <n-card size="small" title="曾经选择过">
          <n-empty v-if="candidateVoteDetail.former.length === 0" description="暂无改票记录" />
          <n-space v-else vertical :size="6">
            <div v-for="row in candidateVoteDetail.former" :key="row.id" class="candidate-voter-row">
              <strong>{{ row.userName }}</strong>
              <span>{{ row.gameId }}</span>
              <small>最后记录 {{ formatDate(row.recordedAt) }}</small>
            </div>
          </n-space>
        </n-card>
      </div>
    </template>
  </n-modal>

  <!-- Edit candidate modal -->
  <n-modal v-model:show="editCandidateModalOpen" preset="card" title="编辑候选项" style="width: 680px; max-width: 95vw" :bordered="true">
    <template #header-extra>
      <n-tag :bordered="false" size="small">{{ editingCandidateSurvey?.title ?? '未知问卷' }}</n-tag>
    </template>
    <n-alert v-if="!editingCandidate" type="warning" :bordered="false">候选项不存在或已被移除。</n-alert>
    <n-form v-else label-placement="top" :show-feedback="false">
      <div class="modal-form-grid">
        <n-form-item
          v-for="field in editingCandidateFields"
          :key="field.id"
          :label="`${field.label}${field.required ? ' *' : ''}`"
          :class="{ 'modal-form-full': field.type === 'textarea' }"
        >
          <n-select
            v-if="field.type === 'select'"
            v-model:value="editCandidateValues[field.key]"
            :options="fieldSelectOptions(field)"
            placeholder="请选择"
          />
          <n-input
            v-else-if="field.type === 'textarea'"
            v-model:value="editCandidateValues[field.key]"
            type="textarea"
            :rows="3"
            :placeholder="field.placeholder"
          />
          <n-input
            v-else
            v-model:value="editCandidateValues[field.key]"
            :placeholder="field.placeholder"
          />
        </n-form-item>
      </div>
      <n-space justify="end" style="margin-top: 20px" :size="12">
        <n-button @click="editCandidateModalOpen = false">取消</n-button>
        <n-button type="primary" @click="saveCandidateEdit">保存修改</n-button>
      </n-space>
    </n-form>
  </n-modal>
</template>
