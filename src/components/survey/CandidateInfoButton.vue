<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { NButton, NModal, NSpace, NTag } from 'naive-ui'
import { CirclePlay, Download, Info } from '../../icons'
import MarkdownGuide from '../common/MarkdownGuide.vue'

defineProps<{
  title: string
  intro?: string
  packUrl?: string
  videoUrl?: string
}>()

const showIntro = ref(false)
const triggerRef = ref<HTMLButtonElement | null>(null)

const setShowIntro = (value: boolean) => {
  showIntro.value = value
  if (!value) void nextTick(() => triggerRef.value?.blur())
}

const openExternal = (url: string) => { window.open(url, '_blank', 'noopener,noreferrer') }
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
      <MarkdownGuide v-if="intro" :source="intro" />
      <n-space v-if="packUrl || videoUrl" vertical :size="10" class="candidate-info-actions">
        <n-button v-if="packUrl" type="primary" size="large" block @click="openExternal(packUrl)">
          <template #icon><Download :size="16" :stroke-width="2" /></template>
          打开整合包链接
        </n-button>
        <n-button v-if="videoUrl" size="large" block secondary @click="openExternal(videoUrl)">
          <template #icon><CirclePlay :size="16" :stroke-width="2" /></template>
          观看宣传视频
        </n-button>
      </n-space>
    </div>
  </n-modal>
</template>
