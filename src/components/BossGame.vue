<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'

// 向父元件 App.vue 發出模式切換事件
const props = defineProps<{ hasEnteredGame: boolean }>()
const emit = defineEmits<{ 
  (e: 'switch-mode'): void
  (e: 'enter-game'): void
}>()

// ===== 常數定義 =====
const GRID_SIZE = 20
const BOSS_ZONE = { xMin: 9, xMax: 12, yMin: 9, yMax: 12 } // Boss 太陽佔據的 4x4 區域

// ===== 警告遮罩與玩家 ID =====
const showWarningOverlay = ref(true)
const playerId = ref('')
const tempPlayerId = ref('')
const showIdOverlay = ref(false)

// 檢查 localStorage 是否已有玩家 ID（從經典模式過來，跳過警告遮罩）
if (typeof window !== 'undefined') {
  const savedId = localStorage.getItem('snake_player_id')
  if (savedId) {
    playerId.value = savedId
    tempPlayerId.value = savedId
    if (props.hasEnteredGame) {
      showWarningOverlay.value = false // 已在當前連線登錄過，直接跳過
    }
  }
}

// ===== 蛇的狀態 =====
const snake = ref([
  { x: 10, y: 3 },
  { x: 9, y: 3 },
  { x: 8, y: 3 },
  { x: 7, y: 3 },
  { x: 6, y: 3 },
])
const direction = ref({ x: 1, y: 0 })
const nextDirection = ref({ x: 1, y: 0 })

// ===== 食物（棉花）=====
const food = ref({ x: 15, y: 3 })

// ===== 遊戲狀態 =====
const gameStatus = ref<'waiting' | 'playing' | 'paused' | 'gameover' | 'victory'>('waiting')
const speed = ref(200)
const baseSpeed = 200

// ===== Boss 戰專屬狀態 =====
const projectiles = ref<Array<{ x: number; y: number; dx: number; dy: number }>>([])
const bossAliveTime = ref(0) // 生存計時（GCD 期間暫停）
const bossElapsedTime = ref(0) // 通關用時（GCD 期間持續計時）
const gcdCorrectCount = ref(0) // GCD 答對次數（5 次獲勝）
const showGcdOverlay = ref(false)
const gcdNumA = ref(0)
const gcdNumB = ref(0)
const gcdPlayerAnswer = ref('')
const gcdWrongShake = ref(false) // 答錯紅色抖動
const showBossVictory = ref(false) // Boss 戰勝利畫面
const wasInBossZone = ref(false) // 追蹤蛇是否在 Boss 區域內（防止重複扣血）
const gcdInputRef = ref<HTMLInputElement | null>(null)

// ===== 太陽能量與護盾 =====
const sunCoins = ref(0)
const projectileSpeed = ref(400) // 砲彈移動的反應式時間間隔 (ms)
const shieldActive = ref(false)
const shieldTimeLeft = ref(0)
let shieldTimer: number | null = null
let shieldCountdownInterval: number | null = null

// ===== 太陽神速狀態 =====
const speedBoostActive = ref(false)
const speedBoostTimeLeft = ref(0)
let speedBoostTimer: number | null = null
let speedBoostCountdownInterval: number | null = null

// ===== 設定選單 =====
const showGrid = ref(true)
const showSettings = ref(false)
const bgmEnabled = ref(true)
const bgmVolume = ref(0.25)
const sfxEnabled = ref(true)
const sfxVolume = ref(0.3)
const startEnabled = ref(true)
const startVolume = ref(0.4)
const omgEnabled = ref(true)
const omgVolume = ref(0.4)

// ===== 音訊系統 =====
let sunAudio: HTMLAudioElement | null = null
let backAudio: HTMLAudioElement | null = null
let omgAudio: HTMLAudioElement | null = null
let audioCtx: AudioContext | null = null
const isAudioUnlocked = ref(false)

// ===== 鍵盤狀態 =====
const pressedKeys = ref<Record<string, boolean>>({})

// ===== 排行榜 =====
const bossLeaderboard = ref<Array<{ name: string; time: number; date: string }>>([])
const showLeaderboardOverlay = ref(false)
const isLoadingLeaderboard = ref(false)

async function fetchGlobalLeaderboard() {
  isLoadingLeaderboard.value = true
  try {
    const res = await fetch('/api/leaderboard')
    const data = await res.json()
    if (data && data.success) {
      bossLeaderboard.value = data.boss || []
    }
  } catch (e) {
    console.warn('讀取世界速度榜失敗，正在嘗試從本地讀取降備:', e)
    const saved = localStorage.getItem('snake_boss_leaderboard')
    if (saved) {
      try {
        bossLeaderboard.value = JSON.parse(saved)
      } catch (_) {}
    }
  } finally {
    isLoadingLeaderboard.value = false
  }
}

// ===== 計時器參照 =====
let gameInterval: number | null = null
let bossShootInterval: number | null = null
let bossTimerInterval: number | null = null
let bossProjectileMoveInterval: number | null = null

// ===== 計算屬性 =====
const formattedElapsed = computed(() => {
  const mins = Math.floor(bossElapsedTime.value / 60)
  const secs = bossElapsedTime.value % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
})

// ===== 輔助函數 =====
function isInBossZone(x: number, y: number): boolean {
  return x >= BOSS_ZONE.xMin && x <= BOSS_ZONE.xMax && y >= BOSS_ZONE.yMin && y <= BOSS_ZONE.yMax
}

function computeGCD(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b > 0) {
    const t = b
    b = a % b
    a = t
  }
  return a
}

// ===== 警告遮罩與玩家登錄 =====
function closeWarningOverlay() {
  showWarningOverlay.value = false
  // 同步初始化 AudioContext
  if (typeof window !== 'undefined') {
    const WebAudioContext = window.AudioContext || (window as any).webkitAudioContext
    if (WebAudioContext && !audioCtx) {
      try { audioCtx = new WebAudioContext() } catch (e) { /* 忽略 */ }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
  }
  initAudioElements()
  
  if (playerId.value) {
    isAudioUnlocked.value = true
    playStartSound()
    if (backAudio && bgmEnabled.value) {
      backAudio.play().catch(() => {})
    }
    emit('enter-game')
  } else {
    showIdOverlay.value = true
  }
}

function submitPlayerId() {
  let finalId = tempPlayerId.value.trim()
  if (!finalId) {
    finalId = `BossSlayer-${Math.floor(Math.random() * 90) + 10}`
  }
  playerId.value = finalId
  tempPlayerId.value = finalId
  if (typeof window !== 'undefined') localStorage.setItem('snake_player_id', finalId)
  showIdOverlay.value = false
  isAudioUnlocked.value = true
  playStartSound()
  if (backAudio && bgmEnabled.value) {
    backAudio.play().catch(() => {})
  }
  emit('enter-game')
}

// ===== 音訊系統 =====
function initAudioElements() {
  if (typeof window !== 'undefined') {
    if (!sunAudio) { sunAudio = new Audio(); sunAudio.preload = 'auto' }
    if (!backAudio) {
      backAudio = new Audio()
      backAudio.src = '/back.mp3'
      backAudio.loop = true
      backAudio.volume = bgmVolume.value
      backAudio.preload = 'auto'
    }
    if (!omgAudio) { omgAudio = new Audio(); omgAudio.preload = 'auto' }
  }
}

function unlockAudio() {
  if (isAudioUnlocked.value) return
  if (typeof window !== 'undefined') {
    const WebAudioContext = window.AudioContext || (window as any).webkitAudioContext
    if (WebAudioContext) {
      if (!audioCtx) { try { audioCtx = new WebAudioContext() } catch (e) { /* 忽略 */ } }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
    }
  }
  initAudioElements()
  if (sunAudio) {
    sunAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAAA'
    sunAudio.play().then(() => { isAudioUnlocked.value = true }).catch(() => {})
  }
  if (omgAudio) {
    omgAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAAA'
    omgAudio.play().catch(() => {})
  }
  if (backAudio && !showWarningOverlay.value && bgmEnabled.value && backAudio.paused) {
    backAudio.play().catch(() => {})
  }
}

function playSunSound() {
  if (!sfxEnabled.value) return
  initAudioElements()
  if (sunAudio) {
    sunAudio.volume = sfxVolume.value
    sunAudio.src = '/China.mp3'
    sunAudio.currentTime = 0
    sunAudio.play().catch(() => {})
  }
}

function playStartSound() {
  if (!startEnabled.value) return
  initAudioElements()
  if (sunAudio) {
    sunAudio.volume = startVolume.value
    sunAudio.src = '/start.mp3'
    sunAudio.currentTime = 0
    sunAudio.play().catch(() => {})
  }
}

function playOmgSound() {
  if (!omgEnabled.value) return
  initAudioElements()
  if (omgAudio) {
    omgAudio.volume = omgVolume.value
    omgAudio.src = '/OMG.mp3'
    omgAudio.currentTime = 0
    omgAudio.play().catch(() => {})
  }
}

function playEatSound() {
  if (!sfxEnabled.value || typeof window === 'undefined') return
  try {
    const WA = window.AudioContext || (window as any).webkitAudioContext
    if (!WA) return
    if (!audioCtx) audioCtx = new WA()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.connect(gain); gain.connect(audioCtx.destination)
    osc.type = 'sine'
    const now = audioCtx.currentTime
    osc.frequency.setValueAtTime(523.25, now)
    osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.08)
    gain.gain.setValueAtTime(sfxVolume.value, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1)
    osc.start(now); osc.stop(now + 0.1)
  } catch (e) { /* 忽略 */ }
}

// 受傷音效：低沉刺耳方波（被砲彈/Boss 打到）
function playHitSound() {
  if (!sfxEnabled.value || typeof window === 'undefined') return
  try {
    const WA = window.AudioContext || (window as any).webkitAudioContext
    if (!WA) return
    if (!audioCtx) audioCtx = new WA()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.connect(gain); gain.connect(audioCtx.destination)
    osc.type = 'square'
    const now = audioCtx.currentTime
    osc.frequency.setValueAtTime(200, now)
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.2)
    gain.gain.setValueAtTime(0.4 * sfxVolume.value, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2)
    osc.start(now); osc.stop(now + 0.2)
  } catch (e) { /* 忽略 */ }
}

// 勝利音效：上行琶音（C5→E5→G5→C6）
function playVictorySound() {
  if (!sfxEnabled.value || typeof window === 'undefined') return
  try {
    if (!audioCtx) return
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const now = audioCtx.currentTime
    const notes = [523.25, 659.25, 783.99, 1046.50]
    notes.forEach((freq, i) => {
      const osc = audioCtx!.createOscillator()
      const gain = audioCtx!.createGain()
      osc.connect(gain); gain.connect(audioCtx!.destination)
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.3 * sfxVolume.value, now + i * 0.15)
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.3)
      osc.start(now + i * 0.15); osc.stop(now + i * 0.15 + 0.3)
    })
  } catch (e) { /* 忽略 */ }
}

// 太陽蛻皮音效
function playPeelSound() {
  if (!sfxEnabled.value || typeof window === 'undefined') return
  try {
    const WA = window.AudioContext || (window as any).webkitAudioContext
    if (!WA) return
    if (!audioCtx) audioCtx = new WA()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.connect(gain); gain.connect(audioCtx.destination)
    osc.type = 'triangle'
    const now = audioCtx.currentTime
    osc.frequency.setValueAtTime(600, now)
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.25)
    gain.gain.setValueAtTime(0.5 * sfxVolume.value, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25)
    osc.start(now); osc.stop(now + 0.25)
  } catch (e) { /* 忽略 */ }
}

// 太陽神速加速音效：高頻率順滑上行滑音
function playSpeedSound() {
  if (!sfxEnabled.value || typeof window === 'undefined') return
  try {
    const WA = window.AudioContext || (window as any).webkitAudioContext
    if (!WA) return
    if (!audioCtx) audioCtx = new WA()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.connect(gain); gain.connect(audioCtx.destination)
    osc.type = 'sine'
    const now = audioCtx.currentTime
    osc.frequency.setValueAtTime(350, now)
    osc.frequency.exponentialRampToValueAtTime(1400, now + 0.15)
    gain.gain.setValueAtTime(0.35 * sfxVolume.value, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
    osc.start(now); osc.stop(now + 0.15)
  } catch (e) { /* 忽略 */ }
}

// 烈日緩速音效
function playSlowSound() {
  if (!sfxEnabled.value || typeof window === 'undefined') return
  try {
    const WA = window.AudioContext || (window as any).webkitAudioContext
    if (!WA) return
    if (!audioCtx) audioCtx = new WA()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.connect(gain); gain.connect(audioCtx.destination)
    osc.type = 'sawtooth'
    const now = audioCtx.currentTime
    osc.frequency.setValueAtTime(220, now)
    osc.frequency.linearRampToValueAtTime(80, now + 0.35)
    gain.gain.setValueAtTime(0.33 * sfxVolume.value, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35)
    osc.start(now); osc.stop(now + 0.35)
  } catch (e) { /* 忽略 */ }
}

// 日冕護盾音效
function playShieldSound() {
  if (!sfxEnabled.value || typeof window === 'undefined') return
  try {
    const WA = window.AudioContext || (window as any).webkitAudioContext
    if (!WA) return
    if (!audioCtx) audioCtx = new WA()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const osc = audioCtx.createOscillator()
    const osc2 = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.connect(gain); osc2.connect(gain); gain.connect(audioCtx.destination)
    osc.type = 'sine'; osc2.type = 'triangle'
    const now = audioCtx.currentTime
    osc.frequency.setValueAtTime(1046.50, now)
    osc.frequency.exponentialRampToValueAtTime(2093.00, now + 0.4)
    osc2.frequency.setValueAtTime(1050.00, now)
    osc2.frequency.exponentialRampToValueAtTime(2100.00, now + 0.4)
    gain.gain.setValueAtTime(0.4 * sfxVolume.value, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4)
    osc.start(now); osc2.start(now); osc.stop(now + 0.4); osc2.stop(now + 0.4)
  } catch (e) { /* 忽略 */ }
}

// ===== 太陽神殿技能 =====
function useSunSpeedSkill() {
  if (sunCoins.value < 1) return
  sunCoins.value -= 1
  playSpeedSound()
  
  speedBoostActive.value = true
  speedBoostTimeLeft.value = 5
  // 加速當前速度兩倍：將移動間隔設定為原速的一半 (100ms)
  speed.value = Math.max(50, Math.floor(baseSpeed / 2))
  
  if (speedBoostTimer) clearTimeout(speedBoostTimer)
  if (speedBoostCountdownInterval) clearInterval(speedBoostCountdownInterval)
  
  if (gameStatus.value === 'playing' && gameInterval) {
    clearInterval(gameInterval)
    gameInterval = setInterval(gameLoop, speed.value) as unknown as number
  }
  
  speedBoostCountdownInterval = setInterval(() => {
    if (speedBoostTimeLeft.value > 1) speedBoostTimeLeft.value -= 1
    else {
      speedBoostTimeLeft.value = 0
      if (speedBoostCountdownInterval) { clearInterval(speedBoostCountdownInterval); speedBoostCountdownInterval = null }
    }
  }, 1000) as unknown as number
  
  speedBoostTimer = setTimeout(() => {
    speed.value = baseSpeed
    speedBoostActive.value = false
    speedBoostTimer = null
    if (gameStatus.value === 'playing' && gameInterval) {
      clearInterval(gameInterval)
      gameInterval = setInterval(gameLoop, speed.value) as unknown as number
    }
  }, 5000) as unknown as number
}

function useSlowDownSkill() {
  if (sunCoins.value < 2) return
  sunCoins.value -= 2
  playSlowSound()
  // 增加砲彈的移動時間間隔 50ms（即降低移動速度，最高不可超過 600ms）
  projectileSpeed.value = Math.min(600, projectileSpeed.value + 50)
  if (gameStatus.value === 'playing' && bossProjectileMoveInterval) {
    clearInterval(bossProjectileMoveInterval)
    bossProjectileMoveInterval = setInterval(moveProjectiles, projectileSpeed.value) as unknown as number
  }
}

function useShieldSkill() {
  if (sunCoins.value < 3) return
  sunCoins.value -= 3
  playShieldSound()
  shieldActive.value = true
  shieldTimeLeft.value = 5
  if (shieldTimer) clearTimeout(shieldTimer)
  if (shieldCountdownInterval) clearInterval(shieldCountdownInterval)
  shieldCountdownInterval = setInterval(() => {
    if (shieldTimeLeft.value > 1) shieldTimeLeft.value -= 1
    else {
      shieldTimeLeft.value = 0
      if (shieldCountdownInterval) { clearInterval(shieldCountdownInterval); shieldCountdownInterval = null }
    }
  }, 1000) as unknown as number
  shieldTimer = setTimeout(() => { shieldActive.value = false; shieldTimer = null }, 5000) as unknown as number
}

// ===== 初始化 Boss 遊戲 =====
function initBossGame() {
  speed.value = baseSpeed
  projectileSpeed.value = 400 // 重置日冕砲彈預設速度為 400ms
  snake.value = [
    { x: 10, y: 3 },
    { x: 9, y: 3 },
    { x: 8, y: 3 },
    { x: 7, y: 3 },
    { x: 6, y: 3 },
  ]
  direction.value = { x: 1, y: 0 }
  nextDirection.value = { x: 1, y: 0 }
  projectiles.value = []
  bossAliveTime.value = 0
  bossElapsedTime.value = 0
  gcdCorrectCount.value = 0
  showGcdOverlay.value = false
  showBossVictory.value = false
  wasInBossZone.value = false
  sunCoins.value = 0
  shieldActive.value = false
  shieldTimeLeft.value = 0
  speedBoostActive.value = false
  speedBoostTimeLeft.value = 0
  if (shieldTimer) { clearTimeout(shieldTimer); shieldTimer = null }
  if (shieldCountdownInterval) { clearInterval(shieldCountdownInterval); shieldCountdownInterval = null }
  if (speedBoostTimer) { clearTimeout(speedBoostTimer); speedBoostTimer = null }
  if (speedBoostCountdownInterval) { clearInterval(speedBoostCountdownInterval); speedBoostCountdownInterval = null }
  generateBossFood()
}

function generateBossFood() {
  let newFood: { x: number; y: number }
  do {
    newFood = {
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE),
    }
  } while (
    snake.value.some(s => s.x === newFood.x && s.y === newFood.y) ||
    isInBossZone(newFood.x, newFood.y)
  )
  food.value = newFood
}

// ===== 主遊戲迴圈 =====
function gameLoop() {
  moveBossSnake()
}

function moveBossSnake() {
  if (snake.value.length === 0) return
  direction.value = { ...nextDirection.value }
  const head = snake.value[0]!
  // 邊界穿透（與經典模式完全一致）
  const newHead = {
    x: (head.x + direction.value.x + GRID_SIZE) % GRID_SIZE,
    y: (head.y + direction.value.y + GRID_SIZE) % GRID_SIZE,
  }

  // 撞到自己身體
  if (snake.value.some(s => s.x === newHead.x && s.y === newHead.y)) {
    if (!shieldActive.value) { bossGameOver(); return }
  }

  // 加入新蛇頭
  snake.value.unshift(newHead)

  // Boss 區域碰撞（僅在「踏入」瞬間觸發一次，不會每幀重複扣血）
  const nowInBoss = isInBossZone(newHead.x, newHead.y)
  if (nowInBoss && !wasInBossZone.value && !shieldActive.value) {
    if (snake.value.length > 0) snake.value.pop() // 扣 1 節身體
    playHitSound()
    if (snake.value.length <= 2) { bossGameOver(); return }
  }
  wasInBossZone.value = nowInBoss

  // 食物碰撞（棉花補血 +1 節，不加分）
  if (newHead.x === food.value.x && newHead.y === food.value.y) {
    playEatSound()
    generateBossFood()
    // 有 30% 的機率額外獲得 1 點太陽能量
    if (Math.random() < 0.3) {
      sunCoins.value++
    }
    // 不移除尾巴 → 蛇身長度 +1
  } else {
    snake.value.pop() // 正常移動，維持長度
  }
}

// ===== 砲彈系統 =====
function fireProjectile() {
  if (gameStatus.value !== 'playing' || showGcdOverlay.value) return
  const head = snake.value[0]
  if (!head) return
  const bossCenterX = 10
  const bossCenterY = 10
  let rawDx = head.x - bossCenterX
  let rawDy = head.y - bossCenterY
  if (rawDx === 0 && rawDy === 0) rawDy = -1

  // 以整數方向向量步進（sign-based 歸一化，每 tick 移動 1 格）
  const stepDx = Math.sign(rawDx)
  const stepDy = Math.sign(rawDy)

  // 從 Boss 區域邊緣外側生成砲彈
  let startX: number, startY: number
  if (stepDx > 0) startX = BOSS_ZONE.xMax + 1
  else if (stepDx < 0) startX = BOSS_ZONE.xMin - 1
  else startX = bossCenterX
  if (stepDy > 0) startY = BOSS_ZONE.yMax + 1
  else if (stepDy < 0) startY = BOSS_ZONE.yMin - 1
  else startY = bossCenterY

  projectiles.value.push({ x: startX, y: startY, dx: stepDx, dy: stepDy })
}

function moveProjectiles() {
  const surviving: Array<{ x: number; y: number; dx: number; dy: number }> = []
  for (const p of projectiles.value) {
    const newX = p.x + p.dx
    const newY = p.y + p.dy
    // 出界移除
    if (newX < 0 || newX >= GRID_SIZE || newY < 0 || newY >= GRID_SIZE) continue
    // Boss 區域內不做碰撞判定
    if (isInBossZone(newX, newY)) {
      surviving.push({ ...p, x: newX, y: newY })
      continue
    }
    // 碰撞蛇身
    const hitSnake = snake.value.some(s => s.x === newX && s.y === newY)
    if (hitSnake) {
      if (!shieldActive.value) {
        snake.value.pop()
        playHitSound()
        if (snake.value.length <= 2) {
          projectiles.value = surviving
          bossGameOver()
          return
        }
      }
      continue // 砲彈消耗
    }
    surviving.push({ ...p, x: newX, y: newY })
  }
  projectiles.value = surviving
}

// ===== GCD 數學大招系統 =====
function triggerGcdChallenge() {
  // 暫停遊戲移動與 Boss 射擊（保留總計時器持續計時）
  if (gameInterval) { clearInterval(gameInterval); gameInterval = null }
  if (bossShootInterval) { clearInterval(bossShootInterval); bossShootInterval = null }
  if (bossProjectileMoveInterval) { clearInterval(bossProjectileMoveInterval); bossProjectileMoveInterval = null }
  gcdNumA.value = Math.floor(Math.random() * 2991) + 10
  gcdNumB.value = Math.floor(Math.random() * 2991) + 10
  gcdPlayerAnswer.value = ''
  gcdWrongShake.value = false
  showGcdOverlay.value = true
}

function submitGcdAnswer() {
  playOmgSound()
  const playerAnswer = parseInt(gcdPlayerAnswer.value, 10)
  const correctAnswer = computeGCD(gcdNumA.value, gcdNumB.value)

  if (playerAnswer === correctAnswer) {
    // 答對！
    gcdCorrectCount.value++
    sunCoins.value++ // 額外獎勵 1 太陽能量
    showGcdOverlay.value = false
    if (gcdCorrectCount.value >= 5) {
      handleBossVictory()
      return
    }
    resumeFromGcd()
  } else {
    // 答錯！抖動特效 + 扣 3 節
    gcdWrongShake.value = true
    for (let i = 0; i < 3 && snake.value.length > 0; i++) {
      snake.value.pop()
    }
    if (snake.value.length <= 2) {
      showGcdOverlay.value = false
      bossGameOver()
      return
    }
    setTimeout(() => {
      gcdWrongShake.value = false
      showGcdOverlay.value = false
      resumeFromGcd()
    }, 1000)
  }
}

function resumeFromGcd() {
  gameInterval = setInterval(gameLoop, speed.value) as unknown as number
  bossShootInterval = setInterval(fireProjectile, 1500) as unknown as number
  bossProjectileMoveInterval = setInterval(moveProjectiles, projectileSpeed.value) as unknown as number
}

// 自動聚焦 GCD 輸入框
watch(showGcdOverlay, (val) => {
  if (val) nextTick(() => { gcdInputRef.value?.focus() })
})

// ===== Boss 計時系統 =====
function startBossTimers() {
  bossTimerInterval = setInterval(() => {
    // 通關用時始終累加（含 GCD 答題期間，鼓勵快速心算）
    bossElapsedTime.value++
    // 生存計時僅在非 GCD Overlay 時累加（每 20 秒觸發大招）
    if (!showGcdOverlay.value) {
      bossAliveTime.value++
      if (bossAliveTime.value % 20 === 0) {
        triggerGcdChallenge()
      }
    }
  }, 1000) as unknown as number
}

// ===== 勝利處理 =====
function handleBossVictory() {
  gameStatus.value = 'victory'
  showBossVictory.value = true
  clearAllTimers()
  playVictorySound()
  playSunSound()
  saveBossTimeToLeaderboard()
}

async function saveBossTimeToLeaderboard() {
  if (bossElapsedTime.value <= 0) return // 不儲存異常或未通關的成績
  const currentName = playerId.value.trim() || '無名戰神'
  const dateStr = new Date().toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })
  
  if (typeof window === 'undefined') return
  
  // 1. 同步寫入本地備份（保障在斷網環境下也能正常紀錄）
  const saved = localStorage.getItem('snake_boss_leaderboard')
  let boardList: any[] = []
  if (saved) { try { boardList = JSON.parse(saved) } catch (e) { /* 忽略 */ } }
  boardList = boardList.filter(r => r.time > 0)
  
  // 同一個 ID 直接覆蓋為個人最佳紀錄 (取通關時間最短者)
  const existingIndex = boardList.findIndex(r => r.name === currentName)
  if (existingIndex !== -1) {
    if (bossElapsedTime.value < boardList[existingIndex].time) {
      boardList[existingIndex].time = bossElapsedTime.value
      boardList[existingIndex].date = dateStr
    }
  } else {
    boardList.push({
      name: currentName,
      time: bossElapsedTime.value,
      date: dateStr
    })
  }

  // 再次進行全域去重防禦（以防萬一）
  const uniqueRecords: any[] = []
  for (const r of boardList) {
    const idx = uniqueRecords.findIndex(u => u.name === r.name)
    if (idx !== -1) {
      if (r.time < uniqueRecords[idx].time) {
        uniqueRecords[idx] = r
      }
    } else {
      uniqueRecords.push(r)
    }
  }
  
  uniqueRecords.sort((a: any, b: any) => a.time - b.time) // 升序排列（最快的在前）
  const trimmed = uniqueRecords.slice(0, 5)
  localStorage.setItem('snake_boss_leaderboard', JSON.stringify(trimmed))
  
  // 2. 非同步 POST 提交到全網聯網世界速度排行榜
  try {
    const response = await fetch('/api/leaderboard', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: currentName,
        time: bossElapsedTime.value,
        mode: 'boss',
        date: dateStr
      })
    })
    const data = await response.json()
    if (data && data.success) {
      bossLeaderboard.value = data.leaderboard || []
    } else {
      bossLeaderboard.value = trimmed
    }
  } catch (e) {
    console.warn('非同步上傳世界速度榜失敗，改為採用本地備份:', e)
    bossLeaderboard.value = trimmed
  }
}

// ===== Game Over =====
function bossGameOver() {
  gameStatus.value = 'gameover'
  clearAllTimers()
}

function clearAllTimers() {
  if (gameInterval) { clearInterval(gameInterval); gameInterval = null }
  if (bossShootInterval) { clearInterval(bossShootInterval); bossShootInterval = null }
  if (bossTimerInterval) { clearInterval(bossTimerInterval); bossTimerInterval = null }
  if (bossProjectileMoveInterval) { clearInterval(bossProjectileMoveInterval); bossProjectileMoveInterval = null }
  if (shieldTimer) { clearTimeout(shieldTimer); shieldTimer = null }
  if (shieldCountdownInterval) { clearInterval(shieldCountdownInterval); shieldCountdownInterval = null }
  if (speedBoostTimer) { clearTimeout(speedBoostTimer); speedBoostTimer = null }
  if (speedBoostCountdownInterval) { clearInterval(speedBoostCountdownInterval); speedBoostCountdownInterval = null }
  speedBoostActive.value = false
  speedBoostTimeLeft.value = 0
}

// ===== 開始 / 暫停 / 繼續 / 重新開始 =====
function startBossGame() {
  initBossGame()
  gameStatus.value = 'playing'
  gameInterval = setInterval(gameLoop, speed.value) as unknown as number
  bossShootInterval = setInterval(fireProjectile, 1500) as unknown as number
  bossProjectileMoveInterval = setInterval(moveProjectiles, projectileSpeed.value) as unknown as number
  startBossTimers()
  playStartSound()
}

function pauseBossGame() {
  if (gameStatus.value === 'playing') {
    gameStatus.value = 'paused'
    clearAllTimers()
  }
}

function resumeBossGame() {
  if (gameStatus.value === 'paused') {
    gameStatus.value = 'playing'
    gameInterval = setInterval(gameLoop, speed.value) as unknown as number
    bossShootInterval = setInterval(fireProjectile, 1500) as unknown as number
    bossProjectileMoveInterval = setInterval(moveProjectiles, projectileSpeed.value) as unknown as number
    startBossTimers()
    playStartSound()
  }
}

function restartBossGame() {
  clearAllTimers()
  startBossGame()
}

// ===== 鍵盤事件處理 =====
function handleInput(e: KeyboardEvent) {
  const rawKey = e.key.toLowerCase()
  pressedKeys.value[rawKey] = true
  unlockAudio()

  // GCD 問答中：僅處理 Enter 提交，不處理遊戲控制
  if (showGcdOverlay.value) {
    if (e.key === 'Enter') { e.preventDefault(); submitGcdAnswer() }
    return
  }
  // 勝利畫面中：忽略所有遊戲控制
  if (showBossVictory.value) return

  if (e.key === ' ') {
    e.preventDefault()
    if (gameStatus.value === 'playing') pauseBossGame()
    else if (gameStatus.value === 'paused') resumeBossGame()
    return
  }

  if (gameStatus.value === 'waiting') {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(e.key)) {
      startBossGame()
    }
  }

  if (gameStatus.value !== 'playing') return

  const key = e.key.toLowerCase()
  // 太陽神殿技能快捷鍵
  if (e.key === 'Shift') { e.preventDefault(); useSunSpeedSkill(); return }
  if (key === 'q') { useSlowDownSkill(); return }
  if (key === 'e') { useShieldSkill(); return }

  // 方向控制
  if ((key === 'arrowup' || key === 'w') && direction.value.y !== 1) {
    nextDirection.value = { x: 0, y: -1 }
  } else if ((key === 'arrowdown' || key === 's') && direction.value.y !== -1) {
    nextDirection.value = { x: 0, y: 1 }
  } else if ((key === 'arrowleft' || key === 'a') && direction.value.x !== 1) {
    nextDirection.value = { x: -1, y: 0 }
  } else if ((key === 'arrowright' || key === 'd') && direction.value.x !== -1) {
    nextDirection.value = { x: 1, y: 0 }
  }
}

function handleKeyUp(e: KeyboardEvent) {
  pressedKeys.value[e.key.toLowerCase()] = false
}

// ===== 設定選單 =====
function toggleSettings() { showSettings.value = !showSettings.value; unlockAudio() }
function toggleGrid() { showGrid.value = !showGrid.value; unlockAudio() }
function toggleBgm() {
  bgmEnabled.value = !bgmEnabled.value; unlockAudio()
  if (backAudio) {
    if (!bgmEnabled.value) backAudio.pause()
    else if (!showWarningOverlay.value) backAudio.play().catch(() => {})
  }
}
function toggleSfx() { sfxEnabled.value = !sfxEnabled.value; unlockAudio() }
function toggleStart() { startEnabled.value = !startEnabled.value; unlockAudio() }
function toggleOmg() { omgEnabled.value = !omgEnabled.value; unlockAudio() }
function toggleLeaderboard() { 
  showLeaderboardOverlay.value = !showLeaderboardOverlay.value; 
  unlockAudio(); 
  if (showLeaderboardOverlay.value) {
    fetchGlobalLeaderboard();
  }
}

watch(bgmVolume, (v) => { if (backAudio) backAudio.volume = v })

// ===== 生命週期 =====
onMounted(() => {
  window.addEventListener('keydown', handleInput)
  window.addEventListener('keyup', handleKeyUp)
  
  // 首次嘗試獲取雲端速度排行榜
  fetchGlobalLeaderboard()
  
  // 若已登錄（從經典模式切換過來），自動初始化音訊
  if (playerId.value) {
    initAudioElements()
    if (backAudio && bgmEnabled.value) backAudio.play().catch(() => {})
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleInput)
  window.removeEventListener('keyup', handleKeyUp)
  clearAllTimers()
  if (backAudio) { backAudio.pause(); backAudio = null }
})

// ===== 棋盤格子計算屬性 =====
const cells = computed(() => {
  const result = []
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const isSnake = snake.value.findIndex(s => s.x === x && s.y === y)
      const isFood = food.value.x === x && food.value.y === y
      const isBoss = isInBossZone(x, y)
      result.push({
        x, y,
        isSnake: isSnake !== -1,
        isSnakeHead: isSnake === 0,
        isFood,
        isBossZone: isBoss,
      })
    }
  }
  return result
})

// 格式化排行榜時間為 MM:SS
function formatLeaderboardTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <div class="boss-game">
    <!-- 警告遮罩（僅在未登錄時顯示） -->
    <Transition name="fade">
      <div v-if="showWarningOverlay" class="warning-overlay">
        <div class="warning-content">
          <div class="sunglasses-icon">🕶️</div>
          <p class="warning-text">為避免陽光照射，請戴上墨鏡遊玩</p>
          <p class="volume-warning-text">🔊 貼心提醒：進入後將播放背景音樂，請注意音量大小</p>
          <button class="warning-btn" @click="closeWarningOverlay">戴上墨鏡 😎 進入遊戲</button>
        </div>
      </div>
    </Transition>

    <!-- 玩家 ID 輸入遮罩 -->
    <Transition name="fade">
      <div v-if="showIdOverlay" class="warning-overlay id-input-overlay">
        <div class="warning-content id-content">
          <div class="sunglasses-icon">⚔️</div>
          <p class="warning-text">登錄太陽神殿</p>
          <p class="volume-warning-text">請輸入您的玩家 ID 以登載歷史功勳紀錄</p>
          <div class="id-input-wrapper">
            <input type="text" v-model="tempPlayerId" placeholder="輸入您的玩家 ID..."
              class="id-input-field" @keydown.enter="submitPlayerId" maxlength="12" />
            <span class="tech-corner top-left"></span>
            <span class="tech-corner top-right"></span>
            <span class="tech-corner bottom-left"></span>
            <span class="tech-corner bottom-right"></span>
          </div>
          <button class="warning-btn submit-id-btn" @click="submitPlayerId">確認登錄 ⚔️</button>
        </div>
      </div>
    </Transition>

    <!-- Boss 速度排行榜彈窗 -->
    <Transition name="fade">
      <div v-if="showLeaderboardOverlay" class="warning-overlay leaderboard-overlay" @click.self="showLeaderboardOverlay = false">
        <div class="warning-content leaderboard-dialog">
          <div class="sunglasses-icon rank-crown">⚡</div>
          <p class="warning-text">世界 Boss 速度榜</p>
          <p class="volume-warning-text">🌐 全球通關最快的前五名菁英戰神</p>
          
          <!-- 骨架屏載入動畫 -->
          <div v-if="isLoadingLeaderboard" class="skeleton-container">
            <div v-for="i in 5" :key="i" class="skeleton-row">
              <div class="skeleton-badge"></div>
              <div class="skeleton-name"></div>
              <div class="skeleton-score"></div>
              <div class="skeleton-date"></div>
            </div>
          </div>
          
          <table v-else class="score-table popup-table">
            <thead>
              <tr>
                <th class="th-rank">排名</th>
                <th class="th-player">玩家 ID</th>
                <th class="th-score">用時</th>
                <th class="th-date">日期</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(entry, index) in bossLeaderboard" :key="index" :class="'rank-' + (index + 1)">
                <td class="rank-num"><span class="rank-badge">{{ index + 1 }}</span></td>
                <td class="player-name">{{ entry.name }}</td>
                <td class="score-val">{{ formatLeaderboardTime(entry.time) }}</td>
                <td class="score-date">{{ entry.date || '--/--' }}</td>
              </tr>
              <tr v-if="bossLeaderboard.length === 0">
                <td colspan="4" class="no-records"><span class="no-records-text">暫無通關紀錄 🌌</span></td>
              </tr>
            </tbody>
          </table>
          <button class="warning-btn close-leaderboard-btn" @click="showLeaderboardOverlay = false">離開殿堂 ⚔️</button>
        </div>
      </div>
    </Transition>

    <!-- GCD 數學大招問答 Overlay -->
    <Transition name="fade">
      <div v-if="showGcdOverlay" class="warning-overlay gcd-overlay">
        <div class="warning-content gcd-content" :class="{ 'gcd-wrong': gcdWrongShake }">
          <div class="sunglasses-icon gcd-boss-icon">☀️</div>
          <p class="warning-text gcd-title">太陽 Boss 大招！</p>
          <p class="volume-warning-text">求出以下兩數的最大公因數 (GCD)</p>
          <div class="gcd-numbers">
            <span class="gcd-num">{{ gcdNumA }}</span>
            <span class="gcd-and">&amp;</span>
            <span class="gcd-num">{{ gcdNumB }}</span>
          </div>
          <div class="id-input-wrapper">
            <input type="number" ref="gcdInputRef" v-model="gcdPlayerAnswer"
              class="id-input-field gcd-input" placeholder="輸入答案..."
              @keydown.enter="submitGcdAnswer" />
            <span class="tech-corner top-left"></span>
            <span class="tech-corner top-right"></span>
            <span class="tech-corner bottom-left"></span>
            <span class="tech-corner bottom-right"></span>
          </div>
          <button class="warning-btn gcd-submit-btn" @click="submitGcdAnswer">提交答案 ⚔️</button>
          <p class="gcd-progress-label">答對進度: {{ gcdCorrectCount }} / 5</p>
        </div>
      </div>
    </Transition>

    <!-- Boss 勝利全螢幕慶祝 -->
    <Transition name="fade">
      <div v-if="showBossVictory" class="warning-overlay victory-overlay">
        <div class="warning-content victory-content">
          <div class="sunglasses-icon victory-icon">🏆</div>
          <p class="warning-text victory-title">擊敗太陽 Boss！</p>
          <p class="volume-warning-text">通關用時: {{ formattedElapsed }}</p>
          <p class="volume-warning-text">GCD 全數答對 5 / 5 ✨</p>
          <div class="victory-actions">
            <button class="warning-btn" @click="restartBossGame">重新挑戰 ⚔️</button>
            <button class="warning-btn submit-id-btn" @click="toggleLeaderboard">查看速度榜 ⚡</button>
            <button class="warning-btn close-leaderboard-btn" @click="emit('switch-mode')">返回經典模式 🌀</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 主要佈局：棋盤 + 右側說明面板 -->
    <div class="game-layout">
      <!-- 左側：工具列 + 棋盤 -->
      <div class="header">
        <div class="toolbar">
          <div class="score boss-length-bar">🐍 長度: {{ snake.length }}</div>
          <div class="score boss-timer-bar">⏱️ {{ formattedElapsed }}</div>
          <div class="score sun-energy-bar" title="太陽能量">
            ☀️ <span class="sun-coin-count">{{ sunCoins }}</span>
          </div>
          <button class="settings-btn mode-switch-btn" @click="emit('switch-mode')" title="切換至經典模式">
            <span class="settings-btn-icon">🌀</span>經典
          </button>
          <button class="settings-btn leaderboard-btn" :class="{ active: showLeaderboardOverlay }"
            @click="toggleLeaderboard" title="Boss 速度榜">
            <span class="settings-btn-icon">⚡</span>速度榜
          </button>
          <div class="settings-container">
            <button class="settings-btn" :class="{ active: showSettings }" @click="toggleSettings" title="遊戲設定">
              <span class="settings-btn-icon">⚙️</span>設定
            </button>
            <div v-if="showSettings" class="settings-backdrop" @click="showSettings = false"></div>
            <Transition name="slide-up">
              <div v-if="showSettings" class="settings-dropdown">
                <div class="settings-dropdown-header">⚙️ 遊戲設定</div>
                <div class="settings-dropdown-body">
                  <div class="settings-row">
                    <div class="settings-row-info"><span class="settings-row-title">網格線顯示</span><span class="settings-row-desc">顯示或隱藏棋盤背景格線</span></div>
                    <button class="settings-toggle-btn" :class="{ active: showGrid }" @click="toggleGrid">{{ showGrid ? 'ON' : 'OFF' }}</button>
                  </div>
                  <div class="settings-row">
                    <div class="settings-row-info"><span class="settings-row-title">背景音樂 (BGM)</span><span class="settings-row-desc">開關並調整背景音樂</span></div>
                    <button class="settings-toggle-btn sound-toggle" :class="{ active: bgmEnabled }" @click="toggleBgm">{{ bgmEnabled ? 'ON' : 'OFF' }}</button>
                  </div>
                  <div class="settings-volume-row">
                    <span class="volume-label">BGM 音量: {{ Math.round(bgmVolume * 100) }}%</span>
                    <input type="range" min="0" max="1" step="0.05" v-model.number="bgmVolume" class="volume-slider bgm-slider" @input="unlockAudio" />
                  </div>
                  <div class="settings-row">
                    <div class="settings-row-info"><span class="settings-row-title">遊戲音效 (SFX)</span><span class="settings-row-desc">開關並調整音效</span></div>
                    <button class="settings-toggle-btn sound-toggle" :class="{ active: sfxEnabled }" @click="toggleSfx">{{ sfxEnabled ? 'ON' : 'OFF' }}</button>
                  </div>
                  <div class="settings-volume-row">
                    <span class="volume-label">SFX 音量: {{ Math.round(sfxVolume * 100) }}%</span>
                    <input type="range" min="0" max="1" step="0.05" v-model.number="sfxVolume" class="volume-slider sfx-slider" @input="unlockAudio" />
                  </div>
                  <div class="settings-row">
                    <div class="settings-row-info"><span class="settings-row-title">啟動音效 (Start)</span><span class="settings-row-desc">開關並調整開始與繼續音效</span></div>
                    <button class="settings-toggle-btn sound-toggle" :class="{ active: startEnabled }" @click="toggleStart">{{ startEnabled ? 'ON' : 'OFF' }}</button>
                  </div>
                  <div class="settings-volume-row">
                    <span class="volume-label">啟動音量: {{ Math.round(startVolume * 100) }}%</span>
                    <input type="range" min="0" max="1" step="0.05" v-model.number="startVolume" class="volume-slider start-slider" @input="unlockAudio" />
                  </div>
                  <div class="settings-row">
                    <div class="settings-row-info"><span class="settings-row-title">大招音效 (OMG)</span><span class="settings-row-desc">開關並調整大招答題音效</span></div>
                    <button class="settings-toggle-btn sound-toggle" :class="{ active: omgEnabled }" @click="toggleOmg">{{ omgEnabled ? 'ON' : 'OFF' }}</button>
                  </div>
                  <div class="settings-volume-row">
                    <span class="volume-label">OMG 音量: {{ Math.round(omgVolume * 100) }}%</span>
                    <input type="range" min="0" max="1" step="0.05" v-model.number="omgVolume" class="volume-slider omg-slider" @input="unlockAudio" />
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <!-- 遊戲棋盤 -->
        <div class="game-board" :class="{ 'show-grid': showGrid, 'shield-active-board': shieldActive }">
          <div v-for="cell in cells" :key="`${cell.x}-${cell.y}`" class="cell"
            :class="{
              cotton: cell.isFood,
              snake: cell.isSnake,
              'snake-head': cell.isSnakeHead,
              'boss-zone': cell.isBossZone && !cell.isSnake,
            }"></div>

          <!-- Boss 太陽 4x4 覆蓋 -->
          <div class="boss-sun-wrapper">
            <img src="/sun.png" class="boss-sun-img" alt="太陽 Boss" />
          </div>

          <!-- 砲彈渲染 -->
          <div v-for="(proj, index) in projectiles" :key="'proj-' + index"
            class="projectile" :style="{ left: proj.x * 30 + 'px', top: proj.y * 30 + 'px' }"></div>

          <!-- 護盾剩餘時間提示 -->
          <Transition name="fade">
            <div v-if="shieldActive" class="shield-status-overlay">🛡️ 日冕護盾中: {{ shieldTimeLeft }}秒</div>
          </Transition>

          <!-- 加速剩餘時間提示 -->
          <Transition name="fade">
            <div v-if="speedBoostActive" class="shield-status-overlay speed-status-overlay">⚡ 太陽神速中: {{ speedBoostTimeLeft }}秒</div>
          </Transition>

          <!-- 砲彈緩速提示 -->
          <Transition name="fade">
            <div v-if="projectileSpeed > 400" class="shield-status-overlay slow-status-overlay">⏳ 烈日緩速中 (砲彈間隔: {{ projectileSpeed }}ms)</div>
          </Transition>

          <!-- 遊戲狀態 Overlay -->
          <div v-if="gameStatus === 'waiting'" class="overlay">
            <p class="overlay-title">⚔️ Boss 戰模式</p>
            <p class="overlay-sub">按方向鍵挑戰太陽 Boss</p>
          </div>
          <div v-if="gameStatus === 'paused'" class="overlay">
            <p class="overlay-title">暫停</p>
            <p class="overlay-sub">按空白鍵繼續</p>
          </div>
          <div v-if="gameStatus === 'gameover'" class="overlay gameover-overlay">
            <p class="overlay-title">被太陽融化了...</p>
            <p class="overlay-sub">生存時間: {{ formattedElapsed }}</p>
            <p class="overlay-sub">GCD 進度: {{ gcdCorrectCount }} / 5</p>
            <div class="gameover-actions">
              <button @click="restartBossGame" class="gameover-btn">重新挑戰</button>
              <button @click="emit('switch-mode')" class="gameover-btn secondary-btn">返回經典 🌀</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右側說明面板 -->
      <aside class="side-panel">
        <!-- Boss 戰資訊 -->
        <div class="info-block boss-info">
          <h2 class="info-title">🎯 Boss 戰資訊</h2>
          <div class="boss-stats">
            <div class="stat-row">
              <span class="stat-label">🐍 蛇身長度</span>
              <span class="stat-value">{{ snake.length }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">⏱️ 生存時間</span>
              <span class="stat-value">{{ formattedElapsed }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">🧮 GCD 進度</span>
              <span class="stat-value gcd-val">{{ gcdCorrectCount }} / 5</span>
            </div>
            <div class="gcd-progress-bar">
              <div class="gcd-progress-fill" :style="{ width: (gcdCorrectCount / 5 * 100) + '%' }"></div>
            </div>
          </div>
        </div>

        <!-- Boss 戰規則 -->
        <div class="info-block">
          <h2 class="info-title">📜 Boss 戰規則</h2>
          <ul class="info-list">
            <li>閃避赤紅砲彈，被擊中扣 1 節 🔥</li>
            <li>碰到 Boss 太陽扣 1 節 ☀️</li>
            <li>吃棉花補血 +1 節 ☁️</li>
            <li>每 20 秒觸發 GCD 數學大招 🧮</li>
            <li>答對 5 次即可擊敗 Boss 🏆</li>
            <li>蛇身 ≤ 2 節則遊戲結束 💀</li>
          </ul>
        </div>

        <!-- 操作說明 -->
        <div class="info-block">
          <h2 class="info-title">🎮 操作說明</h2>
          <div class="controls">
            <div class="key-group">
              <div class="key-row"><kbd class="key" :class="{ pressed: pressedKeys['w'] || pressedKeys['arrowup'] }">W</kbd></div>
              <div class="key-row">
                <kbd class="key" :class="{ pressed: pressedKeys['a'] || pressedKeys['arrowleft'] }">A</kbd>
                <kbd class="key" :class="{ pressed: pressedKeys['s'] || pressedKeys['arrowdown'] }">S</kbd>
                <kbd class="key" :class="{ pressed: pressedKeys['d'] || pressedKeys['arrowright'] }">D</kbd>
              </div>
              <p class="key-label" :class="{ blink: gameStatus === 'waiting' }">
                {{ gameStatus === 'waiting' ? '▶ 按方向鍵開始' : '或方向鍵控制移動' }}
              </p>
            </div>
            <div class="key-group">
              <div class="key-row"><kbd class="key wide" :class="{ pressed: pressedKeys[' '] }">Space</kbd></div>
              <p class="key-label" :class="{ 'blink-paused': gameStatus === 'paused' }">
                {{ gameStatus === 'paused' ? '⏸ 暫停中 (按空白鍵繼續)' : '遊戲暫停 / 繼續' }}
              </p>
            </div>
          </div>
        </div>

        <!-- 太陽神殿 -->
        <div class="info-block sun-temple">
          <h2 class="info-title">⛩️ 太陽神殿</h2>
          <div class="temple-shop">
            <div class="shop-item" :class="{ affordable: sunCoins >= 1 }">
              <div class="shop-item-info"><span class="shop-item-title">⚡ 太陽神速</span><span class="shop-item-desc">速度加倍維持5秒</span></div>
              <button class="shop-buy-btn" :disabled="sunCoins < 1 || gameStatus !== 'playing'" @click="useSunSpeedSkill">
                <span class="cost">1 ☀️</span><kbd class="shop-kbd">Shift</kbd>
              </button>
            </div>
            <div class="shop-item" :class="{ affordable: sunCoins >= 2 }">
              <div class="shop-item-info"><span class="shop-item-title">⏳ 烈日緩速</span><span class="shop-item-desc">砲彈移動間隔 +50ms</span></div>
              <button class="shop-buy-btn" :disabled="sunCoins < 2 || gameStatus !== 'playing'" @click="useSlowDownSkill">
                <span class="cost">2 ☀️</span><kbd class="shop-kbd">Q</kbd>
              </button>
            </div>
            <div class="shop-item" :class="{ affordable: sunCoins >= 3 }">
              <div class="shop-item-info"><span class="shop-item-title">🛡️ 日冕護盾</span><span class="shop-item-desc">5秒無敵/白金流光/穿透</span></div>
              <button class="shop-buy-btn" :disabled="sunCoins < 3 || gameStatus !== 'playing'" @click="useShieldSkill">
                <span class="cost">3 ☀️</span><kbd class="shop-kbd">E</kbd>
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700&display=swap');

/* ===== Transition 動畫 ===== */
.fade-enter-active, .fade-leave-active { transition: opacity 0.5s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-up-enter-active, .slide-up-leave-active { transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
.slide-up-enter-from, .slide-up-leave-to { opacity: 0; transform: translateY(8px) scale(0.96); }

/* ===== 主容器 ===== */
.boss-game {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 100vh; position: relative; overflow: hidden;
  font-family: 'Orbitron', sans-serif;
  background: radial-gradient(circle at 50% 50%, #200808 0%, #0a0305 100%);
}
.boss-game::before {
  content: ''; position: absolute; width: 600px; height: 600px;
  background: radial-gradient(circle, rgba(255, 80, 0, 0.06) 0%, transparent 70%);
  top: -10%; left: -10%; z-index: 0; pointer-events: none;
  animation: auroraFlowOne 25s ease-in-out infinite alternate;
}
.boss-game::after {
  content: ''; position: absolute; width: 700px; height: 700px;
  background: radial-gradient(circle, rgba(255, 30, 0, 0.04) 0%, transparent 70%);
  bottom: -15%; right: -10%; z-index: 0; pointer-events: none;
  animation: auroraFlowTwo 30s ease-in-out infinite alternate;
}
@keyframes auroraFlowOne {
  0% { transform: translate(0, 0) scale(1) rotate(0deg); }
  50% { transform: translate(80px, 50px) scale(1.1) rotate(180deg); }
  100% { transform: translate(-40px, -60px) scale(0.9) rotate(360deg); }
}
@keyframes auroraFlowTwo {
  0% { transform: translate(0, 0) scale(1) rotate(0deg); }
  50% { transform: translate(-60px, -90px) scale(1.15) rotate(-180deg); }
  100% { transform: translate(50px, 40px) scale(0.95) rotate(-360deg); }
}

/* ===== 警告遮罩 ===== */
.warning-overlay {
  position: fixed; inset: 0; z-index: 10000; background: #000;
  display: flex; align-items: center; justify-content: center;
  background-image: radial-gradient(circle at center, rgba(255, 80, 0, 0.08) 0%, rgba(0, 0, 0, 1) 70%);
}
.warning-content { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 40px; }
.sunglasses-icon { font-size: 80px; filter: drop-shadow(0 0 20px rgba(255, 100, 0, 0.4)); animation: floatIcon 3s ease-in-out infinite; }
.warning-text {
  font-size: clamp(20px, 4vw, 32px); font-weight: 700; color: #fff; letter-spacing: 2px; margin: 0;
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.6), 0 0 20px rgba(255, 255, 255, 0.2); line-height: 1.5;
}
.warning-btn {
  background: linear-gradient(135deg, #3b1010, #1a0808); color: #ff6633;
  border: 2px solid rgba(255, 102, 51, 0.4); padding: 16px 36px;
  font-size: clamp(16px, 2.5vw, 20px); font-weight: 700; font-family: 'Orbitron', sans-serif;
  border-radius: 9999px; cursor: pointer;
  box-shadow: 0 0 15px rgba(255, 102, 51, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  transition: all 0.3s ease; letter-spacing: 1px;
}
.warning-btn:hover {
  background: linear-gradient(135deg, #1a0808, #0a0303); color: #fff; border-color: #ff6633;
  transform: translateY(-3px) scale(1.05);
  box-shadow: 0 0 25px rgba(255, 102, 51, 0.6), 0 0 50px rgba(255, 102, 51, 0.2);
}
.volume-warning-text {
  font-size: 14px; color: rgba(255, 255, 255, 0.45); margin: -10px 0 10px 0;
  display: flex; align-items: center; gap: 8px;
  animation: pulseVolumeWarning 2.5s ease-in-out infinite;
}
@keyframes pulseVolumeWarning {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 0.95; color: #ff8844; text-shadow: 0 0 12px rgba(255, 136, 68, 0.4); transform: scale(1.02); }
}
@keyframes floatIcon { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-10px) rotate(3deg); } }

/* ===== ID 輸入 ===== */
.id-input-overlay { background: rgba(10, 3, 3, 0.95) !important; backdrop-filter: blur(20px) !important; }
.id-content { gap: 16px !important; }
.id-input-wrapper { position: relative; width: min(85vw, 280px); margin: 10px 0 15px 0; }
.id-input-field {
  width: 100%; padding: 12px 16px; background: rgba(30, 10, 10, 0.7);
  border: 1px solid rgba(255, 102, 51, 0.25); border-radius: 8px; color: #fff;
  font-family: 'Orbitron', sans-serif; font-size: 16px; font-weight: 700; text-align: center;
  outline: none; letter-spacing: 1px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5), inset 0 0 10px rgba(255, 102, 51, 0.03);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.id-input-field:focus { border-color: #ff6633; box-shadow: 0 0 20px rgba(255, 102, 51, 0.4), inset 0 0 10px rgba(255, 102, 51, 0.1); }
.id-input-field::placeholder { color: rgba(255, 255, 255, 0.25); font-weight: normal; font-size: 14px; }
.tech-corner { position: absolute; width: 10px; height: 10px; border: 2px solid rgba(255, 102, 51, 0.4); pointer-events: none; transition: all 0.3s; }
.tech-corner.top-left { top: -2px; left: -2px; border-right: none; border-bottom: none; }
.tech-corner.top-right { top: -2px; right: -2px; border-left: none; border-bottom: none; }
.tech-corner.bottom-left { bottom: -2px; left: -2px; border-right: none; border-top: none; }
.tech-corner.bottom-right { bottom: -2px; right: -2px; border-left: none; border-top: none; }
.id-input-field:focus ~ .tech-corner { border-color: #ff6633; filter: drop-shadow(0 0 5px #ff6633); }
.submit-id-btn { color: #ff6633 !important; border-color: rgba(255, 102, 51, 0.4) !important; }

/* ===== 主佈局 ===== */
.game-layout { display: flex; align-items: flex-start; gap: 28px; position: relative; z-index: 2; }
.header { display: flex; flex-direction: column; align-items: center; gap: 16px; }

/* ===== 工具列 ===== */
.toolbar { display: flex; align-items: center; gap: 12px; position: relative; flex-wrap: wrap; justify-content: center; }
.settings-container { position: relative; }
.settings-backdrop { position: fixed; inset: 0; z-index: 98; background: transparent; cursor: default; }
.score {
  color: #ff6633; font-size: 18px; font-weight: 700; letter-spacing: 2px;
  text-shadow: 0 0 10px rgba(255, 102, 51, 0.8), 0 0 20px rgba(255, 102, 51, 0.4);
  background: rgba(30, 10, 10, 0.8); backdrop-filter: blur(12px);
  padding: 10px 18px; border: 1px solid rgba(255, 102, 51, 0.35); border-radius: 8px;
  position: relative; overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), inset 0 0 15px rgba(255, 102, 51, 0.05);
}
.score::after {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 100%;
  background: linear-gradient(to bottom, transparent 0%, rgba(255, 102, 51, 0.04) 50%, transparent 100%);
  pointer-events: none; animation: scoreboardScan 3s linear infinite;
}
@keyframes scoreboardScan { 0% { transform: translateY(-100%); } 100% { transform: translateY(100%); } }

.boss-length-bar { color: #ff8844 !important; border-color: rgba(255, 136, 68, 0.4) !important; }
.boss-timer-bar { color: #ffaa66 !important; border-color: rgba(255, 170, 102, 0.3) !important; font-variant-numeric: tabular-nums; }
.sun-energy-bar {
  color: #ffcc00 !important; border-color: rgba(255, 204, 0, 0.5) !important;
  text-shadow: 0 0 10px #ffcc00, 0 0 20px #ffaa00 !important;
}
.sun-coin-count {
  font-size: 24px; font-weight: 900; color: #fff;
  text-shadow: 0 0 10px #fff, 0 0 20px #ffcc00; display: inline-block;
  animation: sunCoinPulse 2s ease-in-out infinite;
}
@keyframes sunCoinPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); color: #ffeb3b; } }

/* ===== 設定按鈕 ===== */
.settings-btn {
  display: flex; align-items: center; gap: 8px;
  background: rgba(20, 5, 5, 0.6); color: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(255, 102, 51, 0.2); padding: 10px 18px;
  font-size: 14px; font-family: 'Orbitron', sans-serif; border-radius: 6px;
  cursor: pointer; letter-spacing: 1px; box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.settings-btn-icon { font-size: 16px; transition: transform 0.5s ease; }
.settings-btn:hover { color: #ff6633; border-color: rgba(255, 102, 51, 0.5); box-shadow: 0 0 15px rgba(255, 102, 51, 0.2); transform: translateY(-1px); }
.settings-btn.active { color: #ff6633; border-color: rgba(255, 102, 51, 0.8); background: rgba(40, 15, 10, 0.8); box-shadow: 0 0 12px rgba(255, 102, 51, 0.4); text-shadow: 0 0 8px rgba(255, 102, 51, 0.6); }
.mode-switch-btn { border-color: rgba(0, 200, 255, 0.4) !important; }
.mode-switch-btn:hover { color: #00ccff !important; border-color: rgba(0, 200, 255, 0.7) !important; box-shadow: 0 0 15px rgba(0, 200, 255, 0.3) !important; }
.leaderboard-btn { border-color: rgba(255, 204, 0, 0.4) !important; }
.leaderboard-btn:hover { color: #ffcc00 !important; border-color: rgba(255, 204, 0, 0.7) !important; }
.leaderboard-btn.active { color: #ffcc00 !important; border-color: rgba(255, 204, 0, 0.9) !important; background: rgba(45, 35, 10, 0.85) !important; }

/* ===== 設定選單 ===== */
.settings-dropdown {
  position: absolute; top: calc(100% + 12px); right: 0; z-index: 99; width: 300px;
  background: rgba(20, 8, 8, 0.95); backdrop-filter: blur(14px); border: 1px solid rgba(255, 102, 51, 0.25);
  border-radius: 8px; padding: 16px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.85), 0 0 25px rgba(255, 102, 51, 0.12);
}
.settings-dropdown-header { font-size: 14px; font-weight: 700; color: #ff6633; letter-spacing: 1.5px; text-shadow: 0 0 8px rgba(255, 102, 51, 0.5); border-bottom: 1px solid rgba(255, 102, 51, 0.15); padding-bottom: 10px; margin-bottom: 12px; text-align: left; }
.settings-dropdown-body { display: flex; flex-direction: column; gap: 12px; }
.settings-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
.settings-row-info { display: flex; flex-direction: column; gap: 2px; text-align: left; }
.settings-row-title { font-size: 13px; font-weight: 700; color: #fff; }
.settings-row-desc { font-size: 10px; color: rgba(255, 255, 255, 0.45); font-family: sans-serif; }
.settings-toggle-btn {
  width: 54px; height: 26px; background: rgba(0, 0, 0, 0.6); color: rgba(255, 255, 255, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 9999px; font-size: 11px;
  font-family: 'Orbitron', sans-serif; font-weight: 700; cursor: pointer; transition: all 0.25s ease;
  display: flex; align-items: center; justify-content: center;
}
.settings-toggle-btn.active { color: #ff6633; border-color: rgba(255, 102, 51, 0.6); box-shadow: 0 0 8px rgba(255, 102, 51, 0.4); text-shadow: 0 0 6px #ff6633; background: rgba(255, 102, 51, 0.08); }
.settings-toggle-btn.sound-toggle.active { color: #00ff88; border-color: rgba(0, 255, 136, 0.6); box-shadow: 0 0 8px rgba(0, 255, 136, 0.4); text-shadow: 0 0 6px #00ff88; background: rgba(0, 255, 136, 0.08); }
.settings-volume-row { display: flex; flex-direction: column; gap: 6px; padding: 4px 0 10px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
.volume-label { font-size: 11px; color: rgba(255, 255, 255, 0.6); font-family: sans-serif; text-align: left; }
.volume-slider { -webkit-appearance: none; width: 100%; height: 4px; background: rgba(255, 255, 255, 0.1); border-radius: 9999px; outline: none; }
.volume-slider.bgm-slider::-webkit-slider-thumb { -webkit-appearance: none; height: 12px; width: 12px; border-radius: 50%; background: #ff6633; cursor: pointer; margin-top: -4px; box-shadow: 0 0 6px rgba(255, 102, 51, 0.8); }
.volume-slider.sfx-slider::-webkit-slider-thumb { -webkit-appearance: none; height: 12px; width: 12px; border-radius: 50%; background: #00ff88; cursor: pointer; margin-top: -4px; box-shadow: 0 0 6px rgba(0, 255, 136, 0.8); }
.volume-slider.start-slider::-webkit-slider-thumb { -webkit-appearance: none; height: 12px; width: 12px; border-radius: 50%; background: #a855f7; cursor: pointer; margin-top: -4px; box-shadow: 0 0 6px rgba(168, 85, 247, 0.8); }

/* ===== 遊戲棋盤 ===== */
.game-board {
  display: grid; grid-template-columns: repeat(20, 30px); grid-template-rows: repeat(20, 30px);
  border: 2px solid #5a1a1a; background: linear-gradient(rgba(20, 8, 8, 0.95), rgba(10, 3, 3, 0.95));
  border-radius: 8px; position: relative;
  box-shadow: 0 0 50px rgba(255, 50, 0, 0.12), inset 0 0 100px rgba(0, 0, 0, 0.8), 0 0 1px 3px rgba(255, 80, 0, 0.25);
}
.game-board.show-grid::after {
  content: ''; position: absolute; inset: 0; border-radius: 8px; pointer-events: none;
  background:
    repeating-linear-gradient(to right, rgba(255, 100, 50, 0.08) 0px, rgba(255, 100, 50, 0.08) 1px, transparent 1px, transparent 30px),
    repeating-linear-gradient(to bottom, rgba(255, 100, 50, 0.08) 0px, rgba(255, 100, 50, 0.08) 1px, transparent 1px, transparent 30px);
}
.cell { width: 30px; height: 30px; }

/* ===== Boss 區域 ===== */
.boss-zone { background: rgba(255, 50, 0, 0.08); box-shadow: inset 0 0 12px rgba(255, 50, 0, 0.15); }
.boss-sun-wrapper {
  position: absolute; left: calc(9 * 30px); top: calc(9 * 30px);
  width: calc(4 * 30px); height: calc(4 * 30px); z-index: 5; pointer-events: none;
  display: flex; align-items: center; justify-content: center;
}
.boss-sun-img {
  width: 150%; height: 150%; object-fit: contain;
  animation: bossSunRotate 10s linear infinite, bossSunPulse 3s ease-in-out infinite;
  filter: hue-rotate(-10deg) saturate(1.4) drop-shadow(0 0 25px rgba(255, 80, 0, 0.9)) drop-shadow(0 0 50px rgba(255, 30, 0, 0.6));
}
@keyframes bossSunRotate { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
@keyframes bossSunPulse { 0%, 100% { filter: hue-rotate(-10deg) saturate(1.4) drop-shadow(0 0 25px rgba(255, 80, 0, 0.9)) drop-shadow(0 0 50px rgba(255, 30, 0, 0.6)); } 50% { filter: hue-rotate(-10deg) saturate(1.6) drop-shadow(0 0 35px rgba(255, 100, 0, 1)) drop-shadow(0 0 70px rgba(255, 50, 0, 0.8)); } }

/* ===== 砲彈 ===== */
.projectile {
  position: absolute; width: 30px; height: 30px; z-index: 6; pointer-events: none;
  display: flex; align-items: center; justify-content: center;
}
.projectile::after {
  content: ''; width: 14px; height: 14px;
  background: radial-gradient(circle at 30% 30%, #ff6666, #ff0000, #cc0000);
  border-radius: 50%;
  box-shadow: 0 0 10px rgba(255, 0, 0, 0.8), 0 0 20px rgba(255, 50, 0, 0.5), 0 0 4px rgba(255, 200, 0, 0.6);
  animation: projectilePulse 0.5s ease-in-out infinite;
}
@keyframes projectilePulse { 0%, 100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.3); opacity: 1; } }

/* ===== 棉花食物 ===== */
.cotton { display: flex; justify-content: center; align-items: center; position: relative; overflow: visible; }
.cotton::before {
  content: ''; position: absolute; width: 48px; height: 48px;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.6) 0%, transparent 70%);
  animation: cottonPulse 2.5s ease-in-out infinite; border-radius: 50%;
}
.cotton::after {
  content: '☁️'; font-size: 30px; display: flex; align-items: center; justify-content: center;
  animation: cottonPulse 2.5s ease-in-out infinite;
  filter: drop-shadow(0 0 6px rgba(255, 255, 255, 1)) drop-shadow(0 0 15px rgba(220, 240, 255, 0.7));
}
@keyframes cottonPulse { 0%, 100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.15); opacity: 1; } }

/* ===== 蛇身 ===== */
.snake {
  background: linear-gradient(270deg, #c084fc, #9333ea, #ff6633, #7c3aed);
  background-size: 400% 400%; animation: snakeEnergyFlow 4s ease infinite;
  border-radius: 6px;
  box-shadow: 0 0 10px rgba(147, 51, 234, 0.6), 0 0 20px rgba(255, 102, 51, 0.3), inset 0 1px 3px rgba(255, 255, 255, 0.4);
  position: relative;
}
@keyframes snakeEnergyFlow { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
.snake::before {
  content: ''; position: absolute; top: 5px; left: 2px; right: 2px; height: 3px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.6), transparent); border-radius: 2px;
}
.snake-head {
  background: radial-gradient(ellipse at 30% 30%, #ffffff 0%, #ff6633 55%, #cc3300 100%) !important;
  border-radius: 8px; position: relative;
  box-shadow: 0 0 15px rgba(255, 102, 51, 0.85), 0 0 30px rgba(255, 50, 0, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.5) !important;
}
.snake-head::before, .snake-head::after {
  content: ''; position: absolute; width: 6px; height: 8px;
  background: linear-gradient(180deg, #fff, #1a1a2e); border-radius: 50%; top: 7px;
  box-shadow: 0 0 8px rgba(255, 102, 51, 0.9), 0 0 15px rgba(255, 80, 0, 0.6) !important;
}

/* ===== 護盾狀態 ===== */
.shield-active-board .snake { background: linear-gradient(270deg, #ffffff, #e5e7eb, #ffd700, #f59e0b, #ffffff) !important; background-size: 400% 400% !important; box-shadow: 0 0 20px rgba(255, 215, 0, 0.95), 0 0 35px rgba(255, 255, 255, 0.75), inset 0 1px 3px rgba(255, 255, 255, 0.6) !important; animation: goldShieldFlow 1.2s ease-in-out infinite alternate, snakeEnergyFlow 1.5s ease infinite !important; }
.shield-active-board .snake-head { background: radial-gradient(ellipse at 30% 30%, #ffffff 0%, #ffe066 50%, #cca010 100%) !important; box-shadow: 0 0 30px rgba(255, 215, 0, 1), 0 0 50px rgba(255, 255, 255, 0.9) !important; animation: goldShieldFlow 1.2s ease-in-out infinite alternate !important; }
@keyframes goldShieldFlow { 0% { filter: brightness(1); } 100% { filter: brightness(1.25) drop-shadow(0 0 10px rgba(255, 255, 255, 0.95)); } }
.shield-status-overlay {
  position: absolute; top: 15px; left: 50%; transform: translateX(-50%);
  background: rgba(20, 15, 5, 0.85); backdrop-filter: blur(8px); border: 1px solid rgba(255, 215, 0, 0.5);
  padding: 8px 18px; border-radius: 9999px; color: #ffd700; font-size: 13px; font-weight: 700;
  letter-spacing: 1px; z-index: 8;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5), 0 0 12px rgba(255, 215, 0, 0.35);
  animation: shieldPulse 1.5s ease-in-out infinite;
}
@keyframes shieldPulse { 0%, 100% { opacity: 0.9; } 50% { opacity: 1; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5), 0 0 18px rgba(255, 215, 0, 0.55); } }

/* ===== Overlay ===== */
.overlay {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  background: rgba(20, 8, 8, 0.75); backdrop-filter: blur(16px); padding: 30px;
  width: 85%; max-width: 320px; border-radius: 16px; text-align: center; color: white;
  border: 1px solid rgba(255, 255, 255, 0.08); border-top: 1px solid rgba(255, 102, 51, 0.4);
  z-index: 10;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(255, 102, 51, 0.15);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
}
.overlay p { font-size: 18px; margin: 0; font-weight: 700; letter-spacing: 1px; }
.overlay .overlay-title { font-size: 26px; color: #ff6633; text-shadow: 0 0 10px rgba(255, 102, 51, 0.5); }
.overlay .overlay-sub { font-size: 14px; color: rgba(255, 255, 255, 0.8); }
.gameover-actions { display: flex; gap: 12px; margin-top: 8px; justify-content: center; flex-wrap: wrap; }
.gameover-btn {
  background: linear-gradient(135deg, #cc3300, #aa2200) !important; color: white; border: none;
  padding: 10px 20px !important; font-size: 14px !important; border-radius: 6px; cursor: pointer;
  font-family: 'Orbitron', sans-serif; box-shadow: 0 0 15px rgba(204, 51, 0, 0.4) !important; transition: all 0.25s ease !important;
}
.gameover-btn:hover { box-shadow: 0 0 25px rgba(204, 51, 0, 0.7) !important; transform: scale(1.04); }
.gameover-btn.secondary-btn {
  background: linear-gradient(180deg, rgba(10, 20, 35, 0.85), rgba(5, 10, 20, 0.95)) !important;
  border: 1px solid rgba(0, 200, 255, 0.45) !important; color: #00ccff !important;
}

/* ===== GCD Overlay ===== */
.gcd-overlay { background: rgba(10, 3, 3, 0.92) !important; backdrop-filter: blur(20px) !important; z-index: 10030 !important; }
.gcd-content { gap: 18px !important; }
.gcd-boss-icon { font-size: 64px !important; filter: drop-shadow(0 0 25px rgba(255, 100, 0, 0.8)) !important; }
.gcd-title { color: #ff4400 !important; text-shadow: 0 0 15px rgba(255, 68, 0, 0.6) !important; }
.gcd-numbers { display: flex; align-items: center; gap: 20px; margin: 10px 0; }
.gcd-num { font-size: clamp(28px, 5vw, 48px); font-weight: 900; color: #ffcc00; text-shadow: 0 0 15px rgba(255, 204, 0, 0.8), 0 0 30px rgba(255, 170, 0, 0.4); }
.gcd-and { font-size: 24px; color: rgba(255, 255, 255, 0.5); font-weight: 700; }
.gcd-input { font-size: 24px !important; letter-spacing: 3px !important; }
.gcd-input::-webkit-inner-spin-button, .gcd-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.gcd-input[type='number'] { -moz-appearance: textfield; }
.gcd-submit-btn { color: #ff4400 !important; border-color: rgba(255, 68, 0, 0.5) !important; box-shadow: 0 0 15px rgba(255, 68, 0, 0.3) !important; }
.gcd-submit-btn:hover { color: #fff !important; border-color: #ff4400 !important; box-shadow: 0 0 25px rgba(255, 68, 0, 0.6) !important; }
.gcd-progress-label { font-size: 13px; color: rgba(255, 255, 255, 0.5); letter-spacing: 1px; margin: 0; font-family: sans-serif; }
.gcd-wrong { animation: gcdShake 0.5s ease; border-color: rgba(255, 0, 0, 0.6) !important; box-shadow: 0 0 30px rgba(255, 0, 0, 0.4) !important; }
@keyframes gcdShake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(8px); }
  20%, 40%, 60%, 80% { transform: translateX(-8px); }
}

/* ===== 勝利 Overlay ===== */
.victory-overlay { background: rgba(5, 3, 0, 0.92) !important; backdrop-filter: blur(20px) !important; z-index: 10010 !important; }
.victory-content { gap: 16px !important; }
.victory-icon { font-size: 80px !important; filter: drop-shadow(0 0 30px rgba(255, 204, 0, 0.8)) !important; animation: victoryBounce 1s ease-in-out infinite !important; }
.victory-title { color: #ffcc00 !important; text-shadow: 0 0 15px rgba(255, 204, 0, 0.8), 0 0 40px rgba(255, 170, 0, 0.4) !important; font-size: 36px !important; }
.victory-actions { display: flex; flex-direction: column; gap: 12px; margin-top: 8px; }
@keyframes victoryBounce { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-10px) scale(1.1); } }

/* ===== 右側面板 ===== */
.side-panel {
  width: 220px; display: flex; flex-direction: column; gap: 12px; padding-top: 40px;
  max-height: 85vh; overflow-y: auto; padding-right: 4px;
}
/* 自訂右側面板捲軸 */
.side-panel::-webkit-scrollbar { width: 6px; }
.side-panel::-webkit-scrollbar-track { background: rgba(20, 8, 8, 0.4); border-radius: 4px; }
.side-panel::-webkit-scrollbar-thumb { background: rgba(255, 102, 51, 0.4); border-radius: 4px; }
.side-panel::-webkit-scrollbar-thumb:hover { background: rgba(255, 102, 51, 0.8); }
.info-block {
  background: rgba(20, 8, 8, 0.65); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.06);
  border-top: 1px solid rgba(255, 102, 51, 0.25); border-radius: 12px; padding: 12px 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.info-block:hover { border-top-color: rgba(255, 102, 51, 0.5); border-color: rgba(255, 102, 51, 0.15); transform: translateY(-2px); }
.info-title {
  color: #ff6633; font-size: 13px; font-weight: 700; letter-spacing: 1.5px; margin: 0 0 10px 0;
  text-shadow: 0 0 8px rgba(255, 102, 51, 0.6); border-bottom: 1px solid rgba(255, 102, 51, 0.1);
  padding-bottom: 6px; position: relative;
}
.info-title::after { content: ''; position: absolute; bottom: -1px; left: 0; width: 25px; height: 2px; background: #ff6633; box-shadow: 0 0 6px #ff6633; }
.info-list { margin: 0; padding-left: 16px; color: rgba(255, 255, 255, 0.7); font-size: 12px; font-family: sans-serif; line-height: 1.7; letter-spacing: 0; }

/* ===== Boss 資訊面板 ===== */
.boss-info { border-color: rgba(255, 102, 51, 0.2) !important; background: rgba(30, 10, 5, 0.75) !important; }
.boss-stats { display: flex; flex-direction: column; gap: 8px; }
.stat-row { display: flex; justify-content: space-between; align-items: center; }
.stat-label { font-size: 12px; color: rgba(255, 255, 255, 0.6); font-family: sans-serif; }
.stat-value { font-size: 14px; font-weight: 700; color: #ff8844; text-shadow: 0 0 6px rgba(255, 136, 68, 0.5); }
.gcd-val { color: #ffcc00 !important; text-shadow: 0 0 6px rgba(255, 204, 0, 0.6) !important; }
.gcd-progress-bar { height: 6px; background: rgba(255, 255, 255, 0.08); border-radius: 9999px; overflow: hidden; margin-top: 4px; }
.gcd-progress-fill { height: 100%; background: linear-gradient(90deg, #ff6633, #ffcc00); border-radius: 9999px; transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: 0 0 8px rgba(255, 204, 0, 0.5); }

/* ===== 鍵盤 ===== */
.controls { display: flex; flex-direction: column; gap: 10px; }
.key-group { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.key-row { display: flex; gap: 4px; justify-content: center; }
.key {
  display: inline-flex; align-items: center; justify-content: center; width: 35px; height: 35px;
  background: linear-gradient(180deg, rgba(30, 10, 10, 0.85), rgba(15, 5, 5, 0.95));
  border: 1px solid rgba(255, 102, 51, 0.2); border-bottom: 3px solid rgba(255, 80, 0, 0.4);
  border-radius: 6px; color: rgba(200, 150, 130, 0.6); font-size: 13px;
  font-family: 'Orbitron', sans-serif; font-weight: 700;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4); transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}
.key.pressed {
  color: #fff; background: linear-gradient(180deg, rgba(255, 102, 51, 0.25), rgba(200, 60, 0, 0.15));
  border-color: #ff6633; border-bottom-width: 1px; transform: translateY(2px); text-shadow: 0 0 8px #ff6633;
  box-shadow: 0 0 15px rgba(255, 102, 51, 0.6);
}
.key.wide { width: 82px; font-size: 10px; letter-spacing: 1px; }
.key-label { margin: 4px 0 0; font-size: 11px; font-family: sans-serif; color: rgba(255, 255, 255, 0.45); letter-spacing: 0; }
.blink { animation: blink 1.2s ease-in-out infinite; color: #ff6633 !important; text-shadow: 0 0 8px rgba(255, 102, 51, 0.6); }
.blink-paused { animation: blinkPaused 1.2s ease-in-out infinite; color: #ff8844 !important; }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
@keyframes blinkPaused { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

/* ===== 太陽神殿 ===== */
.sun-temple { border-color: rgba(255, 204, 0, 0.25) !important; background: rgba(20, 15, 5, 0.75) !important; }
.sun-temple .info-title { color: #ffcc00 !important; text-shadow: 0 0 8px rgba(255, 204, 0, 0.6) !important; border-bottom-color: rgba(255, 204, 0, 0.2) !important; }
.temple-shop { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; }
.shop-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 6px; transition: all 0.3s ease; }
.shop-item.affordable { background: rgba(255, 204, 0, 0.03); border-color: rgba(255, 204, 0, 0.15); }
.shop-item-info { display: flex; flex-direction: column; gap: 2px; text-align: left; max-width: 110px; }
.shop-item-title { font-size: 11px; font-weight: 700; color: #fff; }
.shop-item.affordable .shop-item-title { color: #ffeb3b; text-shadow: 0 0 4px rgba(255, 235, 59, 0.3); }
.shop-item-desc { font-size: 9px; color: rgba(255, 255, 255, 0.45); font-family: sans-serif; line-height: 1.2; }
.shop-buy-btn {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  width: 58px; height: 38px; background: rgba(30, 30, 30, 0.8); border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px; cursor: pointer; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); padding: 2px;
}
.shop-buy-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.shop-buy-btn .cost { font-size: 11px; font-weight: 800; color: rgba(255, 255, 255, 0.5); font-family: 'Orbitron', sans-serif; }
.shop-buy-btn .shop-kbd { font-size: 8px; color: rgba(255, 255, 255, 0.3); font-family: 'Orbitron', sans-serif; border: 1px solid rgba(255, 255, 255, 0.15); padding: 0 4px; border-radius: 2px; background: rgba(0, 0, 0, 0.4); margin-top: 1px; transform: scale(0.9); }
.shop-item.affordable .shop-buy-btn { background: linear-gradient(180deg, rgba(80, 60, 20, 0.9), rgba(30, 20, 5, 0.9)); border: 1px solid rgba(255, 204, 0, 0.45); border-bottom: 2px solid rgba(255, 170, 0, 0.6); }
.shop-item.affordable .shop-buy-btn .cost { color: #ffeb3b; text-shadow: 0 0 6px rgba(255, 235, 59, 0.6); }
.shop-item.affordable .shop-buy-btn:hover:not(:disabled) { background: linear-gradient(180deg, rgba(120, 90, 30, 1), rgba(50, 30, 5, 1)); border-color: #ffeb3b; box-shadow: 0 0 15px rgba(255, 204, 0, 0.55); transform: translateY(-2px) scale(1.04); }

/* ===== 排行榜彈窗 ===== */
.leaderboard-overlay { background: rgba(5, 2, 0, 0.93) !important; z-index: 10020 !important; }
.leaderboard-dialog { width: min(90vw, 420px) !important; background: rgba(20, 8, 8, 0.75) !important; border: 1px solid rgba(255, 255, 255, 0.08) !important; border-top: 2px solid rgba(255, 204, 0, 0.45) !important; border-radius: 16px !important; padding: 35px 25px !important; }
.rank-crown { font-size: 64px !important; filter: drop-shadow(0 0 15px rgba(255, 204, 0, 0.5)) !important; }
.score-table { width: 100%; border-collapse: collapse; font-size: 12px; font-family: sans-serif; color: rgba(255, 255, 255, 0.7); }
.popup-table { margin: 15px 0 25px 0 !important; font-size: 13px !important; }
.popup-table th { color: rgba(255, 255, 255, 0.35) !important; font-size: 11px !important; padding: 8px 6px !important; border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important; }
.th-rank { width: 18%; text-align: center; } .th-player { width: 44%; text-align: left; } .th-score { width: 20%; text-align: right; } .th-date { width: 18%; text-align: right; }
.popup-table tr { border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
.popup-table tr:hover { background-color: rgba(255, 255, 255, 0.03); }
.popup-table td { padding: 10px 6px; vertical-align: middle; }
.rank-num { text-align: center; }
.rank-badge { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; font-weight: 900; font-family: 'Orbitron', sans-serif; background: rgba(255, 255, 255, 0.05); color: rgba(255, 255, 255, 0.4); font-size: 10px; border: 1px solid rgba(255, 255, 255, 0.08); }
.player-name { color: rgba(255, 255, 255, 0.75); font-weight: 700; font-family: sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; text-align: left; }
.score-val { text-align: right; color: #ffcc00; font-weight: 700; font-family: 'Orbitron', sans-serif; font-size: 13px; text-shadow: 0 0 6px rgba(255, 204, 0, 0.5); }
.score-date { text-align: right; color: rgba(255, 255, 255, 0.45); font-family: 'Orbitron', sans-serif; font-size: 11px; }
.no-records { text-align: center; padding: 20px 0 !important; }
.no-records-text { color: rgba(255, 255, 255, 0.3); font-family: sans-serif; font-size: 11px; }
.rank-1 .rank-badge { background: rgba(255, 204, 0, 0.12) !important; color: #ffcc00 !important; border-color: rgba(255, 204, 0, 0.4); box-shadow: 0 0 6px rgba(255, 204, 0, 0.25); }
.rank-1 .player-name { color: #ffd700 !important; } .rank-1 .score-val { color: #ffd700 !important; text-shadow: 0 0 8px rgba(255, 215, 0, 0.6) !important; }
.rank-2 .rank-badge { background: rgba(243, 244, 246, 0.08) !important; color: #e5e7eb !important; border-color: rgba(243, 244, 246, 0.3); }
.rank-3 .rank-badge { background: rgba(217, 119, 6, 0.12) !important; color: #f59e0b !important; border-color: rgba(217, 119, 6, 0.3); }
.close-leaderboard-btn { color: #ffcc00 !important; border-color: rgba(255, 204, 0, 0.4) !important; }

/* ===== 技能狀態覆蓋特效 ===== */
.speed-status-overlay {
  top: 55px !important;
  border-color: rgba(255, 102, 51, 0.5) !important;
  color: #ff6633 !important;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5), 0 0 12px rgba(255, 102, 51, 0.35) !important;
  animation: speedStatusPulse 1.5s ease-in-out infinite !important;
}
.slow-status-overlay {
  top: 95px !important;
  border-color: rgba(255, 204, 0, 0.5) !important;
  color: #ffcc00 !important;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5), 0 0 12px rgba(255, 204, 0, 0.35) !important;
  animation: slowStatusPulse 1.5s ease-in-out infinite !important;
}
@keyframes speedStatusPulse { 0%, 100% { opacity: 0.9; } 50% { opacity: 1; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5), 0 0 18px rgba(255, 102, 51, 0.55); } }
@keyframes slowStatusPulse { 0%, 100% { opacity: 0.9; } 50% { opacity: 1; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5), 0 0 18px rgba(255, 204, 0, 0.55); } }

/* 骨架屏載入樣式 */
.skeleton-container {
  width: 100%;
  padding: 15px 0 25px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.skeleton-row {
  display: flex;
  align-items: center;
  height: 43px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  position: relative;
  overflow: hidden;
}

.skeleton-row::after {
  content: "";
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.08) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  animation: skeleton-shimmer 1.6s infinite ease-in-out;
}

@keyframes skeleton-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.skeleton-badge { 
  width: 22px; 
  height: 22px; 
  border-radius: 4px; 
  background: rgba(255, 255, 255, 0.08); 
  margin-left: 10px; 
}

.skeleton-name { 
  width: 110px; 
  height: 14px; 
  border-radius: 4px; 
  background: rgba(255, 255, 255, 0.08); 
  margin-left: 20px; 
}

.skeleton-score { 
  width: 50px; 
  height: 14px; 
  border-radius: 4px; 
  background: rgba(255, 255, 255, 0.08); 
  margin-left: auto; 
  margin-right: 35px; 
}

.skeleton-date { 
  width: 42px; 
  height: 12px; 
  border-radius: 4px; 
  background: rgba(255, 255, 255, 0.08); 
  margin-right: 10px; 
}
</style>
