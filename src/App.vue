<script setup lang="ts">
import { ref } from 'vue'
import SnakeGame from './components/SnakeGame.vue'
import BossGame from './components/BossGame.vue'

// 遊戲模式切換：經典模式 / Boss 戰模式
const gameMode = ref<'classic' | 'boss'>('classic')

// 記錄本次網頁連線是否已經進入過遊戲（看過儀式感遮罩並點擊進入）
const hasEnteredGame = ref(false)
</script>

<template>
  <!-- 依據 gameMode 條件渲染對應的遊戲元件 -->
  <SnakeGame 
    v-if="gameMode === 'classic'" 
    :has-entered-game="hasEnteredGame"
    @enter-game="hasEnteredGame = true"
    @switch-mode="gameMode = 'boss'" 
  />
  <BossGame 
    v-if="gameMode === 'boss'" 
    :has-entered-game="hasEnteredGame"
    @enter-game="hasEnteredGame = true"
    @switch-mode="gameMode = 'classic'" 
  />
</template>

<style scoped></style>
