<script setup lang="ts">
import { computed } from 'vue'

type CalloutTone = 'info' | 'tip' | 'warning'

interface InlineToken {
  type: 'text' | 'strong' | 'link'
  text: string
  href?: string
}

interface MarkdownBlock {
  type: 'paragraph' | 'callout'
  title?: string
  tone?: CalloutTone
  lines: InlineToken[][]
}

const props = defineProps<{
  source: string
}>()

const calloutMeta: Record<string, { title: string; tone: CalloutTone }> = {
  NOTE: { title: '提示', tone: 'info' },
  INFO: { title: '提示', tone: 'info' },
  TIP: { title: '建议', tone: 'tip' },
  IMPORTANT: { title: '重要', tone: 'warning' },
  WARNING: { title: '注意', tone: 'warning' },
  CAUTION: { title: '注意', tone: 'warning' }
}

const normalizeLineBreaks = (value: string) => value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

const safeHref = (value: string) => {
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString()
  } catch {
    return ''
  }
  return ''
}

const parseInline = (line: string): InlineToken[] => {
  const tokens: InlineToken[] = []
  const pattern = /(\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\))/g
  let cursor = 0

  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) tokens.push({ type: 'text', text: line.slice(cursor, index) })

    if (match[2]) {
      tokens.push({ type: 'strong', text: match[2] })
    } else {
      const href = safeHref(match[4] ?? '')
      tokens.push(href ? { type: 'link', text: match[3] ?? href, href } : { type: 'text', text: match[0] })
    }

    cursor = index + match[0].length
  }

  if (cursor < line.length) tokens.push({ type: 'text', text: line.slice(cursor) })
  return tokens
}

const quotedContent = (line: string) => line.trimStart().replace(/^>\s?/, '')

const buildCallout = (lines: string[]): MarkdownBlock => {
  const content = [...lines]
  let title = '提示'
  let tone: CalloutTone = 'info'
  const marker = content[0]?.trim().match(/^\[!(\w+)\]$/)

  if (marker) {
    const meta = calloutMeta[marker[1].toUpperCase()] ?? calloutMeta.NOTE
    title = meta.title
    tone = meta.tone
    content.shift()
  } else if (content[0]?.trim().startsWith('注意')) {
    title = '注意'
    tone = 'warning'
  }

  return {
    type: 'callout',
    title,
    tone,
    lines: content.filter((line) => line.trim()).map(parseInline)
  }
}

const parseMarkdown = (source: string): MarkdownBlock[] => {
  const blocks: MarkdownBlock[] = []
  const lines = normalizeLineBreaks(source).split('\n')
  let index = 0

  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1
      continue
    }

    if (lines[index].trimStart().startsWith('>')) {
      const quotedLines: string[] = []
      while (index < lines.length && lines[index].trimStart().startsWith('>')) {
        quotedLines.push(quotedContent(lines[index]))
        index += 1
      }
      blocks.push(buildCallout(quotedLines))
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length && lines[index].trim() && !lines[index].trimStart().startsWith('>')) {
      paragraphLines.push(lines[index])
      index += 1
    }
    blocks.push({ type: 'paragraph', lines: paragraphLines.map(parseInline) })
  }

  return blocks
}

const blocks = computed(() => parseMarkdown(props.source))
</script>

<template>
  <div class="markdown-guide">
    <template v-for="(block, blockIndex) in blocks" :key="blockIndex">
      <p v-if="block.type === 'paragraph'" class="markdown-guide-paragraph">
        <template v-for="(line, lineIndex) in block.lines" :key="lineIndex">
          <template v-for="(token, tokenIndex) in line" :key="tokenIndex">
            <strong v-if="token.type === 'strong'">{{ token.text }}</strong>
            <a v-else-if="token.type === 'link'" :href="token.href" target="_blank" rel="noopener noreferrer">{{ token.text }}</a>
            <span v-else>{{ token.text }}</span>
          </template>
          <br v-if="lineIndex < block.lines.length - 1" />
        </template>
      </p>

      <aside v-else class="markdown-guide-callout" :class="`tone-${block.tone}`">
        <div class="markdown-guide-callout-title">{{ block.title }}</div>
        <p class="markdown-guide-callout-body">
          <template v-for="(line, lineIndex) in block.lines" :key="lineIndex">
            <template v-for="(token, tokenIndex) in line" :key="tokenIndex">
              <strong v-if="token.type === 'strong'">{{ token.text }}</strong>
              <a v-else-if="token.type === 'link'" :href="token.href" target="_blank" rel="noopener noreferrer">{{ token.text }}</a>
              <span v-else>{{ token.text }}</span>
            </template>
            <br v-if="lineIndex < block.lines.length - 1" />
          </template>
        </p>
      </aside>
    </template>
  </div>
</template>
