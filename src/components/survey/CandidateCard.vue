<script setup lang="ts">
import { NPopover, NProgress, NTag } from 'naive-ui'
import { Info, Download, CirclePlay } from '../../icons'
import type { Candidate } from '../../types'
import MarkdownGuide from '../common/MarkdownGuide.vue'

defineProps<{
  candidate: Candidate
  selected: boolean
  meta: string
  intro: string
  packUrl: string
  videoUrl: string
  category: string
  showStats: boolean
  count: number
  percent: number
  preview?: boolean
}>()

defineEmits<{
  toggle: []
}>()

const openExternal = (url: string) => { window.open(url, '_blank', 'noopener,noreferrer') }
</script>

<template>
  <div
    class="candidate-card"
    :class="{ selected }"
    :style="preview ? 'cursor: default' : ''"
    @click="$emit('toggle')"
  >
    <div class="candidate-card-check" :class="{ active: selected }"></div>
    <div class="candidate-card-body">
      <div class="candidate-card-title-row">
        <div class="candidate-card-title-main">
          <div class="candidate-card-title">{{ candidate.title }}</div>
          <n-tag v-if="category" class="candidate-card-category" size="tiny" :bordered="false" round style="font-size: 11px">{{ category }}</n-tag>
        </div>
        <span v-if="intro || packUrl || videoUrl" class="candidate-card-actions">
          <n-popover v-if="intro" trigger="hover" placement="top" style="max-width: 320px">
            <template #trigger>
              <button class="candidate-icon-btn" type="button" title="查看介绍" aria-label="查看介绍" @click.stop>
                <Info :size="15" :stroke-width="2" aria-hidden="true" />
              </button>
            </template>
            <div class="candidate-intro">
              <MarkdownGuide :source="intro" />
            </div>
          </n-popover>
          <button v-if="packUrl" class="candidate-icon-btn" type="button" title="打开整合包链接" aria-label="打开整合包链接" @click.stop="openExternal(packUrl)">
            <Download :size="15" :stroke-width="2" aria-hidden="true" />
          </button>
          <button v-if="videoUrl" class="candidate-icon-btn" type="button" title="打开宣传视频" aria-label="打开宣传视频" @click.stop="openExternal(videoUrl)">
            <CirclePlay :size="15" :stroke-width="2" aria-hidden="true" />
          </button>
        </span>
      </div>
      <div class="candidate-card-meta">{{ meta || '未填写补充信息' }}</div>
      <div v-if="showStats" class="candidate-card-stats">
        <n-progress :percentage="percent" :show-indicator="false" :height="5" color="#6366f1" rail-color="#e2e8f0" />
      </div>
    </div>
    <div v-if="showStats" class="candidate-card-count">
      <strong>{{ count }}</strong>
      <span>票</span>
    </div>
  </div>
</template>
