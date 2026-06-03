<script setup lang="ts">
import { NModal, NForm, NFormItem, NInput, NSelect, NAlert, NSpace, NButton, NTag } from 'naive-ui'
import { useAppState } from '../../composables/useAppState'
import { useSurveyVote } from '../../composables/useSurveyVote'
import { fieldSelectOptions } from '../../composables/useCandidateFields'

const { survey } = useAppState()
const { candidateModalOpen, submissionMessage, submissionValues, submitCandidate, resetSubmissionValues } = useSurveyVote()

const candidateModalTagText = () => survey.value.candidateSubmission.requiresReview ? '管理员审核后显示' : '提交后立即显示'
const candidateSubmitButtonText = () => survey.value.candidateSubmission.requiresReview ? '提交审核' : '提交候选项'
</script>

<template>
  <n-modal
    v-model:show="candidateModalOpen"
    preset="card"
    title="提交自定义候选项"
    style="width: 680px; max-width: 95vw"
    :bordered="true"
  >
    <template #header-extra>
      <n-tag :bordered="false" size="small">{{ candidateModalTagText() }}</n-tag>
    </template>
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
            v-model:value="submissionValues[field.key]"
            :options="fieldSelectOptions(field)"
            placeholder="请选择"
          />
          <n-input
            v-else-if="field.type === 'textarea'"
            v-model:value="submissionValues[field.key]"
            type="textarea"
            :rows="3"
            :placeholder="field.placeholder"
          />
          <n-input
            v-else
            v-model:value="submissionValues[field.key]"
            :placeholder="field.placeholder"
          />
        </n-form-item>
      </div>
      <n-alert v-if="submissionMessage" type="warning" style="margin-top: 16px" :bordered="false">{{ submissionMessage }}</n-alert>
      <n-space justify="end" style="margin-top: 20px" :size="12">
        <n-button @click="resetSubmissionValues">重置</n-button>
        <n-button type="primary" @click="submitCandidate">{{ candidateSubmitButtonText() }}</n-button>
      </n-space>
    </n-form>
  </n-modal>
</template>
