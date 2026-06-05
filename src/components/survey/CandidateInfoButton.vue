<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { NModal, NTag } from 'naive-ui'
import { Info } from '../../icons'
import MarkdownGuide from '../common/MarkdownGuide.vue'

defineProps<{
  title: string
  intro: string
}>()

const showIntro = ref(false)
const triggerRef = ref<HTMLButtonElement | null>(null)

const setShowIntro = (value: boolean) => {
  showIntro.value = value
  if (!value) void nextTick(() => triggerRef.value?.blur())
}
</script>

<template>
  <button
    ref="triggerRef"
    class="candidate-icon-btn"
    type="button"
    title="查看介绍"
    aria-label="查看介绍"
    :aria-expanded="showIntro"
    @click.stop="setShowIntro(true)"
  >
    <Info :size="15" :stroke-width="2" aria-hidden="true" />
  </button>

  <n-modal
    :show="showIntro"
    preset="card"
    :title="title"
    style="width: 420px; max-width: calc(100vw - 24px)"
    :bordered="true"
    @update:show="setShowIntro"
  >
    <template #header-extra>
      <n-tag :bordered="false" size="small">介绍</n-tag>
    </template>
    <div class="candidate-intro-modal">
      <MarkdownGuide :source="intro" />
    </div>
  </n-modal>
</template>
