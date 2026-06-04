<script setup lang="ts">
import { computed, ref } from 'vue'
import { NAlert, NButton, NCard, NDatePicker, NForm, NFormItem, NInput, NInputNumber, NRadioButton, NRadioGroup, NSelect, NSpace, NSwitch, NTag } from 'naive-ui'
import { Copy, Download, Eye, Save, Settings2 } from '../../icons'
import { useAppState } from '../../composables/useAppState'
import { useAdminSurvey } from '../../composables/useAdminSurvey'
import { navigateAdmin, publicSurveyUrlFor } from '../../composables/useRouter'

type PosterMode = 'mobile' | 'desktop'
type WallpaperKey = 'bedrock' | 'java' | 'bundle'

const { survey, adminSurveyId, surveys, message } = useAppState()
const {
  surveySettingsDraft,
  surveySettingsDirty,
  surveyHasVotes,
  saveSurveySettings
} = useAdminSurvey()

const surveySelectOptions = computed(() => surveys.value.map((s) => ({ label: s.title, value: s.id })))
const hasSurveys = computed(() => surveys.value.length > 0)
const voteModeOptions = [{ label: '单选', value: 'single' }, { label: '多选', value: 'multiple' }]
const statusOptions = [{ label: '草稿', value: 'draft' }, { label: '开放', value: 'open' }, { label: '已关闭', value: 'closed' }]
const resultVisibilityOptions = [
  { label: '投票前后均显示', value: 'always' },
  { label: '投票后显示', value: 'after_vote' },
  { label: '不对玩家显示', value: 'hidden' }
]
const guideTextPlaceholder = [
  '普通段落会保留换行。',
  '',
  '> [!WARNING]',
  '> 这里可以写注意事项。'
].join('\n')

const wallpaperOptions: Array<{ label: string; value: WallpaperKey; desktop: string; mobile: string }> = [
  {
    label: 'Bedrock',
    value: 'bedrock',
    desktop: '/wallpapers/wallpaper_minecraft_bedrock_edition_1920x1080.png',
    mobile: '/wallpapers/wallpaper_minecraft_bedrock_edition_1080x1920.png'
  },
  {
    label: 'Java',
    value: 'java',
    desktop: '/wallpapers/wallpaper_minecraft_java_edition_1920x1080.png',
    mobile: '/wallpapers/wallpaper_minecraft_java_edition_1080x1920.png'
  },
  {
    label: 'PC Bundle',
    value: 'bundle',
    desktop: '/wallpapers/wallpaper_minecraft_pc_bundle_1920x1080.png',
    mobile: '/wallpapers/wallpaper_minecraft_pc_bundle_1080x1920.png'
  }
]

const posterMode = ref<PosterMode>('mobile')
const wallpaperKey = ref<WallpaperKey>('bedrock')

const publicSurveyUrl = computed(() => publicSurveyUrlFor(survey.value.id))
const publicSurveyQrUrl = computed(() => `https://api.qrserver.com/v1/create-qr-code/?size=520x520&margin=12&data=${encodeURIComponent(publicSurveyUrl.value)}`)
const selectedWallpaper = computed(() => wallpaperOptions.find((item) => item.value === wallpaperKey.value) ?? wallpaperOptions[0])
const posterBackground = computed(() => posterMode.value === 'mobile' ? selectedWallpaper.value.mobile : selectedWallpaper.value.desktop)
const posterModeOptions = [
  { label: '手机竖版', value: 'mobile' },
  { label: '电脑横版', value: 'desktop' }
]

const copyPublicLink = async () => {
  try {
    await navigator.clipboard.writeText(publicSurveyUrl.value)
    message.success('已复制公开链接')
  } catch {
    message.warning('复制失败，请手动复制链接。')
  }
}

const openPublicPreview = async () => {
  if (surveySettingsDirty.value) await saveSurveySettings('问卷设置已保存')
  window.open(publicSurveyUrl.value, '_blank', 'noopener,noreferrer')
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => resolve(img)
  img.onerror = reject
  img.src = src
})

const drawCoverImage = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, width: number, height: number) => {
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight)
  const sw = width / scale
  const sh = height / scale
  const sx = (img.naturalWidth - sw) / 2
  const sy = (img.naturalHeight - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height)
}

const wrapText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) => {
  const words = text.split('')
  let line = ''
  let currentY = y
  let lineCount = 0
  for (const word of words) {
    const testLine = `${line}${word}`
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, currentY)
      line = word
      currentY += lineHeight
      lineCount += 1
      if (lineCount >= maxLines - 1) break
    } else {
      line = testLine
    }
  }
  if (line && lineCount < maxLines) ctx.fillText(line, x, currentY)
}

const downloadPoster = async () => {
  const isMobile = posterMode.value === 'mobile'
  const width = isMobile ? 1080 : 1600
  const height = isMobile ? 1350 : 900
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  try {
    const [bg, qr] = await Promise.all([
      loadImage(posterBackground.value),
      loadImage(publicSurveyQrUrl.value)
    ])
    drawCoverImage(ctx, bg, width, height)

    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, 'rgba(7, 15, 35, 0.78)')
    gradient.addColorStop(0.58, 'rgba(7, 15, 35, 0.38)')
    gradient.addColorStop(1, 'rgba(7, 15, 35, 0.78)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    ctx.fillStyle = '#ffffff'
    ctx.textBaseline = 'top'
    ctx.font = `700 ${isMobile ? 72 : 68}px sans-serif`
    const titleX = isMobile ? 72 : 86
    const titleY = isMobile ? 92 : 98
    wrapText(ctx, survey.value.title, titleX, titleY, isMobile ? width - 144 : 760, isMobile ? 88 : 82, 3)

    ctx.font = `400 ${isMobile ? 30 : 28}px sans-serif`
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)'
    wrapText(ctx, survey.value.description || '扫码参与 XDUCraft 投票', titleX, isMobile ? 360 : 330, isMobile ? width - 144 : 720, isMobile ? 44 : 40, 2)

    const qrSize = isMobile ? 330 : 250
    const qrX = isMobile ? (width - qrSize) / 2 : width - qrSize - 104
    const qrY = isMobile ? height - qrSize - 150 : height - qrSize - 116
    ctx.fillStyle = '#ffffff'
    ctx.roundRect(qrX - 24, qrY - 24, qrSize + 48, qrSize + 86, 28)
    ctx.fill()
    ctx.drawImage(qr, qrX, qrY, qrSize, qrSize)
    ctx.font = `500 ${isMobile ? 30 : 24}px sans-serif`
    ctx.fillStyle = '#0f172a'
    ctx.textAlign = 'center'
    ctx.fillText('扫码参与投票', qrX + qrSize / 2, qrY + qrSize + 28)

    const link = document.createElement('a')
    link.download = `${survey.value.title}-${isMobile ? '手机海报' : '电脑海报'}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  } catch {
    message.error('海报生成失败，请稍后重试。')
  }
}
</script>

<template>
  <div class="admin-section-header">
    <div>
      <h1>问卷设置</h1>
      <p>配置当前问卷规则、发布状态和传播物料。</p>
    </div>
  </div>

  <n-alert v-if="!hasSurveys" type="info" :bordered="false">
    还没有问卷。请先在问卷列表中新建问卷。
  </n-alert>

  <n-card v-else size="small">
    <n-form label-placement="top" :show-feedback="false">
      <n-form-item label="选择问卷">
        <n-select v-model:value="adminSurveyId" :options="surveySelectOptions" />
      </n-form-item>
      <n-form-item label="标题">
        <n-input v-model:value="surveySettingsDraft.title" />
      </n-form-item>
      <n-form-item label="状态">
        <n-select v-model:value="surveySettingsDraft.status" :options="statusOptions" />
      </n-form-item>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
        <n-form-item label="开始时间">
          <n-date-picker
            v-model:value="surveySettingsDraft.startsAt"
            type="datetime"
            clearable
            style="width: 100%"
          />
        </n-form-item>
        <n-form-item label="结束时间">
          <n-date-picker
            v-model:value="surveySettingsDraft.endsAt"
            type="datetime"
            clearable
            style="width: 100%"
          />
        </n-form-item>
      </div>
      <n-form-item label="说明">
        <n-input v-model:value="surveySettingsDraft.description" type="textarea" :rows="2" />
      </n-form-item>
      <n-form-item label="答题指引（支持 Markdown）">
        <n-input
          v-model:value="surveySettingsDraft.guideText"
          type="textarea"
          :rows="6"
          :autosize="{ minRows: 5, maxRows: 12 }"
          :placeholder="guideTextPlaceholder"
        />
      </n-form-item>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
        <n-form-item label="模式">
          <n-select v-model:value="surveySettingsDraft.voteMode" :options="voteModeOptions" />
        </n-form-item>
        <n-form-item label="最多项数">
          <n-input-number v-model:value="surveySettingsDraft.maxVotes" :min="1" style="width: 100%" />
        </n-form-item>
      </div>
      <n-form-item label="票数显示">
        <n-select v-model:value="surveySettingsDraft.resultVisibility" :options="resultVisibilityOptions" />
      </n-form-item>
      <n-space vertical :size="10" style="margin: 4px 0 16px">
        <n-space align="center" :size="8"><n-switch v-model:value="surveySettingsDraft.requireLogin" size="small" /><span>强制要求登录</span></n-space>
        <n-space align="center" :size="8"><n-switch v-model:value="surveySettingsDraft.allowVoteEdits" size="small" /><span>允许投票后修改</span></n-space>
        <n-space align="center" :size="8"><n-switch v-model:value="surveySettingsDraft.candidateSubmissionEnabled" size="small" /><span>开放自定义候选项</span></n-space>
        <n-space align="center" :size="8"><n-switch v-model:value="surveySettingsDraft.candidateSubmissionRequiresReview" size="small" /><span>候选项需要审核</span></n-space>
      </n-space>

      <n-alert v-if="surveyHasVotes" type="info" :bordered="false" style="margin-bottom: 16px">
        该问卷已有投票。修改规则会影响之后的提交。
      </n-alert>

      <n-space justify="space-between" align="center" style="margin-bottom: 16px">
        <n-tag :type="surveySettingsDirty ? 'warning' : 'success'" :bordered="false">
          {{ surveySettingsDirty ? '有未保存设置' : '设置已保存' }}
        </n-tag>
        <n-space :size="8">
          <n-button @click="navigateAdmin('fields', adminSurveyId)">
            <template #icon><Settings2 :size="14" /></template>
            配置字段
          </n-button>
          <n-button @click="openPublicPreview">
            <template #icon><Eye :size="14" /></template>
            打开问卷
          </n-button>
          <n-button type="primary" :disabled="!surveySettingsDirty" @click="saveSurveySettings()">
            <template #icon><Save :size="14" /></template>
            保存设置
          </n-button>
        </n-space>
      </n-space>

      <div class="share-section poster-share-section">
        <div class="poster-share-toolbar">
          <div>
            <strong>传播海报</strong>
            <code>{{ publicSurveyUrl }}</code>
          </div>
          <n-space :size="8">
            <n-button size="small" @click="copyPublicLink">
              <template #icon><Copy :size="14" /></template>
              复制链接
            </n-button>
            <n-button size="small" type="primary" @click="downloadPoster">
              <template #icon><Download :size="14" /></template>
              下载海报
            </n-button>
          </n-space>
        </div>

        <div class="poster-controls">
          <n-radio-group v-model:value="posterMode" size="small">
            <n-radio-button v-for="item in posterModeOptions" :key="item.value" :value="item.value">
              {{ item.label }}
            </n-radio-button>
          </n-radio-group>
          <n-radio-group v-model:value="wallpaperKey" size="small">
            <n-radio-button v-for="item in wallpaperOptions" :key="item.value" :value="item.value">
              {{ item.label }}
            </n-radio-button>
          </n-radio-group>
        </div>

        <div class="poster-preview-wrap">
          <div class="poster-card" :class="posterMode" :style="{ backgroundImage: `url(${posterBackground})` }">
            <div class="poster-card-overlay">
              <div class="poster-card-copy">
                <span>XDUCraft Vote</span>
                <strong>{{ survey.title }}</strong>
                <small>{{ survey.description || '扫码参与问卷投票' }}</small>
              </div>
              <div class="poster-card-qr">
                <img :src="publicSurveyQrUrl" alt="问卷二维码" />
                <span>扫码参与投票</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </n-form>
  </n-card>
</template>
