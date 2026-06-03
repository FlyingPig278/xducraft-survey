<script setup lang="ts">
import { computed } from 'vue'
import {
  NCard, NForm, NFormItem, NInput, NSelect, NSpace, NButton,
  NAlert, NTag, NEmpty, NModal
} from 'naive-ui'
import { Check, X, Undo2, Pencil } from '../../icons'
import { useAppState } from '../../composables/useAppState'
import { useAdminCandidates } from '../../composables/useAdminCandidates'
import { useCandidateFields, fieldSelectOptions, statusLabel, statusTagType, formatDate } from '../../composables/useCandidateFields'

const { survey, adminSurveyId, surveys, surveyById, surveyTitleById } = useAppState()
const {
  candidateFilter, reviewNotes, adminCandidateValues,
  editCandidateValues, editCandidateModalOpen,
  adminCandidateRows, editingCandidate, editingCandidateSurvey, editingCandidateFields,
  initAdminCandidateValues, resetAdminCandidateValues,
  createAdminCandidate, openEditCandidate, saveCandidateEdit, setCandidateStatus
} = useAdminCandidates()
const { candidateReviewFields } = useCandidateFields(surveyById)

const surveySelectOptions = computed(() => surveys.value.map((s) => ({ label: s.title, value: s.id })))
const hasSurveys = computed(() => surveys.value.length > 0)
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
        <n-button size="small" @click="openEditCandidate(c)">
          <template #icon><Pencil :size="14" /></template>
          编辑
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
      </n-space>
    </div>
  </n-space>

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
