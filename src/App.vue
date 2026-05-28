<script setup lang="ts">
import { ref } from 'vue'
import SnakeGame from './components/SnakeGame.vue'
import BossGame from './components/BossGame.vue'

// 遊戲模式切換：經典模式 / Boss 戰模式
const gameMode = ref<'classic' | 'boss'>('classic')
</script>

<template>
  <!-- 依據 gameMode 條件渲染對應的遊戲元件 -->
  <SnakeGame v-if="gameMode === 'classic'" @switch-mode="gameMode = 'boss'" />
  <BossGame v-if="gameMode === 'boss'" @switch-mode="gameMode = 'classic'" />
</template>

<style scoped></style>
