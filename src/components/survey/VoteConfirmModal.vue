<script setup lang="ts">
import { computed } from 'vue'
import { NModal, NSpace, NTag } from 'naive-ui'
import { useAppState } from '../../composables/useAppState'
import { useSurveyVote } from '../../composables/useSurveyVote'

const { survey } = useAppState()
const { voteConfirmOpen, currentVote, selectedCandidates, confirmSubmitVote } = useSurveyVote()

const title = computed(() => currentVote.value ? '确认修改投票？' : '确认提交投票？')
const description = computed(() => {
  if (currentVote.value) return '本次提交会覆盖你当前的投票选择，并保留修改记录。'
  return survey.value.allowVoteEdits ? '本问卷允许在开放期间修改投票。' : '提交后本问卷不允许修改，请确认你的选择无误。'
})
</script>

<template>
  <n-modal
    v-model:show="voteConfirmOpen"
    preset="dialog"
    :title="title"
    :positive-text="currentVote ? '确认修改' : '确认提交'"
    negative-text="返回检查"
    @positive-click="confirmSubmitVote"
    @negative-click="voteConfirmOpen = false"
  >
    <p style="color: #64748b">{{ description }}</p>
    <n-space vertical :size="6">
      <n-tag v-for="c in selectedCandidates" :key="c.id" :bordered="false" type="info" round>{{ c.title }}</n-tag>
    </n-space>
  </n-modal>
</template>
