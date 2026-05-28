<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

// 向父元件 App.vue 發出模式切換事件
const props = defineProps<{ hasEnteredGame: boolean }>()
const emit = defineEmits<{ 
  (e: 'switch-mode'): void
  (e: 'enter-game'): void
}>()

const GRID_SIZE = 20

// 剛進入網頁時的警告遮罩開關，預設為開啟 (true)
const showWarningOverlay = ref(true)

// 玩家 ID 登錄與高分排行榜響應式狀態
const playerId = ref('')
const tempPlayerId = ref('')
const showIdOverlay = ref(false)
const showLeaderboardOverlay = ref(false)
const leaderboard = ref<Array<{ name: string; score: number; date: string }>>([])

function toggleLeaderboard() {
  showLeaderboardOverlay.value = !showLeaderboardOverlay.value
  unlockAudio() // 點擊時同步預載並解鎖音效，優雅升級 Autoplay 體驗
}

// 初始化讀取 LocalStorage 中的資料
if (typeof window !== 'undefined') {
  const savedId = localStorage.getItem('snake_player_id')
  if (savedId) {
    playerId.value = savedId
    tempPlayerId.value = savedId
    if (props.hasEnteredGame) {
      showWarningOverlay.value = false // 已登錄過且進入過遊戲，才直接跳過警告遮罩
    }
  }
  const savedLeaderboard = localStorage.getItem('snake_leaderboard')
  if (savedLeaderboard) {
    try {
      leaderboard.value = JSON.parse(savedLeaderboard)
    } catch (e) {
      console.warn('讀取排行榜失敗:', e)
    }
  }
}

function closeWarningOverlay() {
  showWarningOverlay.value = false
  
  // 1. 同步在「同步互動調用棧」中直接初始化與解鎖 AudioContext
  if (typeof window !== 'undefined') {
    const WebAudioContext = window.AudioContext || (window as any).webkitAudioContext
    if (WebAudioContext) {
      if (!audioCtx) {
        try {
          audioCtx = new WebAudioContext()
        } catch (e) {
          console.warn('AudioContext 初始化失敗:', e)
        }
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {})
      }
    }
  }
  
  // 3. 同步初始化 Audio 實例，為點擊登錄時的正式播放做足預載準備
  initAudioElements()
  
  if (playerId.value) {
    isAudioUnlocked.value = true
    playStartSound()
    if (backAudio && bgmEnabled.value) {
      backAudio.play().catch((e) => { console.warn('背景音樂播放被瀏覽器阻擋:', e) })
    }
    emit('enter-game')
  } else {
    // 2. 顯示輸入玩家 ID 的 Overlay 遮罩
    showIdOverlay.value = true
  }
}

// 確認登錄玩家 ID 邏輯
function submitPlayerId() {
  let finalId = tempPlayerId.value.trim()
  if (!finalId) {
    // 智慧自動生成酷炫電馭叛客 ID
    const randomSuffix = Math.floor(Math.random() * 90) + 10 // 10 到 99 隨機後綴
    finalId = `CyberRunner-${randomSuffix}`
  }
  
  playerId.value = finalId
  tempPlayerId.value = finalId
  
  if (typeof window !== 'undefined') {
    localStorage.setItem('snake_player_id', finalId)
  }
  
  // 關閉 ID 輸入彈窗
  showIdOverlay.value = false
  
  // 4. 使用者在「確認登錄」的同步點擊 Callstack 中，直接完成 100% 播放 start.mp3 與音訊解鎖！
  isAudioUnlocked.value = true
  playStartSound()
  
  // 5. 同步播放背景音樂 back.mp3
  if (backAudio && bgmEnabled.value) {
    backAudio.play().catch((e) => {
      console.warn('背景音樂播放被瀏覽器阻擋，將於使用者操作後重試:', e)
    })
  }
  emit('enter-game')
}

const snake = ref([
  { x: 10, y: 10 },
  { x: 9, y: 10 },
  { x: 8, y: 10 },
])

const direction = ref({ x: 1, y: 0 })
const nextDirection = ref({ x: 1, y: 0 })

const food = ref({ x: 15, y: 5 })

const score = ref(0)

const gameStatus = ref<'waiting' | 'playing' | 'paused' | 'gameover'>('waiting')

const speed = ref(200)
const baseSpeed = 200

// 格子線顯示開關，預設為開啟
const showGrid = ref(true)
function toggleGrid() {
  showGrid.value = !showGrid.value
  unlockAudio() // 藉由使用者點擊按鈕的互動，主動預載並解鎖音效檔案
}

// 加速功能開關，預設為開啟
const enableSpeedUp = ref(true)
function toggleSpeedUp() {
  enableSpeedUp.value = !enableSpeedUp.value
  unlockAudio() // 藉由使用者點擊按鈕的互動，主動預載並解鎖音效檔案
  // 如果關閉加速，且遊戲正在進行中，立刻將當前速度還原為基本速度
  if (!enableSpeedUp.value) {
    speed.value = baseSpeed
    if (gameStatus.value === 'playing' && gameInterval) {
      clearInterval(gameInterval)
      gameInterval = setInterval(moveSnake, speed.value) as unknown as number
    }
  }
}

// --- 背景音樂 (BGM) 設定 ---
const bgmEnabled = ref(true)
const bgmVolume = ref(0.25) // 範圍 0.0 到 1.0

function toggleBgm() {
  bgmEnabled.value = !bgmEnabled.value
  unlockAudio()
  if (backAudio) {
    if (!bgmEnabled.value) {
      backAudio.pause()
    } else {
      if (!showWarningOverlay.value) {
        backAudio.play().catch((e) => {
          console.warn('播放背景音樂被阻擋:', e)
        })
      }
    }
  }
}

// --- 遊戲音效 (SFX) 設定 ---
const sfxEnabled = ref(true)
const sfxVolume = ref(0.3) // 範圍 0.0 到 1.0

function toggleSfx() {
  sfxEnabled.value = !sfxEnabled.value
  unlockAudio()
}

// --- 啟動音效 (Start) 設定 ---
const startEnabled = ref(true)
const startVolume = ref(0.4) // 範圍 0.0 到 1.0

function toggleStart() {
  startEnabled.value = !startEnabled.value
  unlockAudio()
}

// 監聽背景音樂的音量變動，即時反映到 BGM 實例上
watch(bgmVolume, (newVolume) => {
  if (backAudio) {
    backAudio.volume = newVolume
  }
})

// ⚙️ 設定選單顯示狀態，預設為關閉 (false)
const showSettings = ref(false)
function toggleSettings() {
  showSettings.value = !showSettings.value
  unlockAudio() // 點擊設定按鈕時主動預載與解鎖音效，優雅升級 Autoplay 體驗
}

// 鍵盤即時敲擊亮燈回饋的響應式狀態追蹤
const pressedKeys = ref<Record<string, boolean>>({})

// --- 太陽能量商店系統響應式狀態 ---
const sunCoins = ref(0) // 目前擁有的太陽能量點數 (每 50 分特效獲得 1 ☀️)
const shieldActive = ref(false) // 日冕無敵護盾狀態
const shieldTimeLeft = ref(0) // 護盾剩餘描述
let shieldTimer: number | null = null
let shieldCountdownInterval: number | null = null

// 宣告音效元件的快取
let sunAudio: HTMLAudioElement | null = null
let backAudio: HTMLAudioElement | null = null // 背景音樂 Audio 實例
let lastPlayedSrc = '' // 記錄上一次播放的音效路徑，防止連續重複播放相同音效
let audioCtx: AudioContext | null = null

// 初始化全域音效實例
function initAudioElements() {
  if (typeof window !== 'undefined') {
    if (!sunAudio) {
      sunAudio = new Audio()
      sunAudio.preload = 'auto'
    }
    if (!backAudio) {
      backAudio = new Audio()
      backAudio.src = '/back.mp3'
      backAudio.loop = true
      backAudio.volume = bgmVolume.value // 初始化時即套用使用者設定的 BGM 音量
      backAudio.preload = 'auto'
    }
  }
}

const isAudioUnlocked = ref(false)

// 瀏覽器安全解鎖：在使用者第一次點擊或操作時進行無聲播放，解鎖 Autoplay 限制並預載
function unlockAudio() {
  if (isAudioUnlocked.value) return
  
  // 1. 優先在「同步互動調用棧」中直接初始化與解鎖 AudioContext
  // 這可以 100% 保證 Web Audio API 不會因為非同步 Microtask 而被瀏覽器判定為無交互 Suspended！
  if (typeof window !== 'undefined') {
    const WebAudioContext = window.AudioContext || (window as any).webkitAudioContext
    if (WebAudioContext) {
      if (!audioCtx) {
        try {
          audioCtx = new WebAudioContext()
        } catch (e) {
          console.warn('AudioContext 初始化失敗:', e)
        }
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {})
      }
    }
  }

  // 2. 使用全域的 sunAudio 來播放臨時無聲音效，藉此 100% 讓瀏覽器直接對該實例開綠燈！
  initAudioElements()
  if (sunAudio) {
    sunAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAAA'
    sunAudio.play().then(() => {
      isAudioUnlocked.value = true
    }).catch((e) => {
      console.warn('尚未成功解鎖音訊權限，將於使用者點擊或操作後解鎖:', e)
    })
  }

  // 3. 嘗試解鎖並播放背景音樂（如果警告遮罩已關閉且背景音樂啟用中）
  if (backAudio && !showWarningOverlay.value && bgmEnabled.value && backAudio.paused) {
    backAudio.play().catch(() => {})
  }
}

// 播放太陽慶祝特效音效（依據使用者要求只使用 China.mp3，不再使用 China_2.mp3）
function playSunSound() {
  if (!sfxEnabled.value) return
  try {
    initAudioElements()
    if (sunAudio) {
      sunAudio.volume = sfxVolume.value // 套用特效音量設定
      sunAudio.src = '/China.mp3'
      sunAudio.currentTime = 0 // 重設播放進度以利連續播放
      sunAudio.play().catch(e => {
        console.warn('太陽音效播放被瀏覽器阻擋，將於使用者點擊或操作後解鎖:', e)
      })
    }
  } catch (e) {
    console.warn('音效播放失敗:', e)
  }
}

// 播放進入遊戲與繼續遊戲時的 start.mp3 音效
function playStartSound() {
  if (!startEnabled.value) return
  try {
    initAudioElements()
    if (sunAudio) {
      sunAudio.volume = startVolume.value // 套用啟動音效獨立音量設定
      sunAudio.src = '/start.mp3'
      sunAudio.currentTime = 0 // 重設播放進度以利連續或快速重啟時能重新播放
      sunAudio.play().catch((e) => {
        console.warn('播放 start.mp3 被瀏覽器阻擋，將於使用者點擊或操作後解鎖:', e)
      })
    }
  } catch (e) {
    console.warn('播放 start.mp3 失敗:', e)
  }
}

// 播放吃到食物的清脆電子音效（採用 Web Audio API 純 JS 動態合成）
function playEatSound() {
  if (!sfxEnabled.value) return
  try {
    if (typeof window === 'undefined') return
    const WebAudioContext = window.AudioContext || (window as any).webkitAudioContext
    if (!WebAudioContext) return
    
    // 惰性加載 AudioContext
    if (!audioCtx) {
      audioCtx = new WebAudioContext()
    }
    
    // 確保處於 running 狀態
    if (audioCtx.state === 'suspended') {
      audioCtx.resume()
    }
    
    // 建立聲音合成節點
    const osc = audioCtx.createOscillator()
    const gainNode = audioCtx.createGain()
    
    osc.connect(gainNode)
    gainNode.connect(audioCtx.destination)
    
    // 使用 sine 正弦波，聲音最清脆溫和
    osc.type = 'sine'
    
    const now = audioCtx.currentTime
    // 快速清脆的上升滑音：C5(523.25Hz) 快速滑到 G5(783.99Hz)，營造紅白機復古清脆感
    osc.frequency.setValueAtTime(523.25, now)
    osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.08)
    
    // 特效音效音量套用至 Web Audio API 合成增益（直接使用 sfxVolume 值）
    gainNode.gain.setValueAtTime(sfxVolume.value, now)
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.1)
    
    osc.start(now)
    osc.stop(now + 0.1)
  } catch (e) {
    console.warn('合成吃食物音效失敗:', e)
  }
}

// 播放【太陽蛻皮】合成音效（下行滑音模擬沙沙蛻皮感）
function playPeelSound() {
  if (!sfxEnabled.value) return
  try {
    if (typeof window === 'undefined') return
    const WebAudioContext = window.AudioContext || (window as any).webkitAudioContext
    if (!WebAudioContext) return
    if (!audioCtx) audioCtx = new WebAudioContext()
    if (audioCtx.state === 'suspended') audioCtx.resume()

    const osc = audioCtx.createOscillator()
    const gainNode = audioCtx.createGain()
    
    osc.connect(gainNode)
    gainNode.connect(audioCtx.destination)
    
    osc.type = 'triangle' // 使用三角波，音色更柔和沙沙感
    const now = audioCtx.currentTime
    
    // 下行快速滑音：600Hz 快速衰減到 150Hz，模擬蛻去身體的滑動感
    osc.frequency.setValueAtTime(600, now)
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.25)
    
    gainNode.gain.setValueAtTime(0.5 * sfxVolume.value, now)
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.25)
    
    osc.start(now)
    osc.stop(now + 0.25)
  } catch (e) {
    console.warn('合成蛻皮音效失敗:', e)
  }
}

// 播放【烈日緩速】合成音效（低沉漸慢波動，模擬時空凝結）
function playSlowSound() {
  if (!sfxEnabled.value) return
  try {
    if (typeof window === 'undefined') return
    const WebAudioContext = window.AudioContext || (window as any).webkitAudioContext
    if (!WebAudioContext) return
    if (!audioCtx) audioCtx = new WebAudioContext()
    if (audioCtx.state === 'suspended') audioCtx.resume()

    const osc = audioCtx.createOscillator()
    const gainNode = audioCtx.createGain()
    
    osc.connect(gainNode)
    gainNode.connect(audioCtx.destination)
    
    osc.type = 'sawtooth' // 鋸齒波，加點低通濾波模擬沉重感
    const now = audioCtx.currentTime
    
    // 漸慢頻率波動：從 220Hz 漸變至 80Hz
    osc.frequency.setValueAtTime(220, now)
    osc.frequency.linearRampToValueAtTime(80, now + 0.35)
    
    gainNode.gain.setValueAtTime(0.33 * sfxVolume.value, now)
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.35)
    
    osc.start(now)
    osc.stop(now + 0.35)
  } catch (e) {
    console.warn('合成緩速音效失敗:', e)
  }
}

// 播放【日冕護盾】合成音效（高亢白金充能顫音，科幻發光防護感）
function playShieldSound() {
  if (!sfxEnabled.value) return
  try {
    if (typeof window === 'undefined') return
    const WebAudioContext = window.AudioContext || (window as any).webkitAudioContext
    if (!WebAudioContext) return
    if (!audioCtx) audioCtx = new WebAudioContext()
    if (audioCtx.state === 'suspended') audioCtx.resume()

    const osc = audioCtx.createOscillator()
    const osc2 = audioCtx.createOscillator() // 雙振盪器合成和弦顫音
    const gainNode = audioCtx.createGain()
    
    osc.connect(gainNode)
    osc2.connect(gainNode)
    gainNode.connect(audioCtx.destination)
    
    osc.type = 'sine'
    osc2.type = 'triangle'
    
    const now = audioCtx.currentTime
    // 高亢上升充能 C6(1046.50Hz) 快速滑到 C7(2093.00Hz)，並有微調音差
    osc.frequency.setValueAtTime(1046.50, now)
    osc.frequency.exponentialRampToValueAtTime(2093.00, now + 0.4)
    
    osc2.frequency.setValueAtTime(1050.00, now)
    osc2.frequency.exponentialRampToValueAtTime(2100.00, now + 0.4)
    
    gainNode.gain.setValueAtTime(0.4 * sfxVolume.value, now)
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.4)
    
    osc.start(now)
    osc2.start(now)
    osc.stop(now + 0.4)
    osc2.stop(now + 0.4)
  } catch (e) {
    console.warn('合成護盾音效失敗:', e)
  }
}

// 兌換技能 1：太陽蛻皮 (消耗 1 ☀️，縮短身體 30%)
function usePeelSkill() {
  if (sunCoins.value < 1) return
  sunCoins.value -= 1
  playPeelSound()
  
  // 削減身體 30% 長度（最少保留基礎長度 3）
  const originalLength = snake.value.length
  const keepCount = Math.max(3, Math.ceil(originalLength * 0.7))
  snake.value = snake.value.slice(0, keepCount)
}

// 兌換技能 2：烈日緩速 (消耗 2 ☀️，增加移動間隔 50ms)
function useSlowDownSkill() {
  if (sunCoins.value < 2) return
  sunCoins.value -= 2
  playSlowSound()
  
  // 強制降速（增加 moveSnake 的間隔），上限為基礎速度 baseSpeed
  speed.value = Math.min(baseSpeed, speed.value + 50)
  if (gameStatus.value === 'playing' && gameInterval) {
    clearInterval(gameInterval)
    gameInterval = setInterval(moveSnake, speed.value) as unknown as number
  }
}

// 兌換技能 3：日冕護盾 (消耗 3 ☀️，獲得 5 秒無敵)
function useShieldSkill() {
  if (sunCoins.value < 3) return
  sunCoins.value -= 3
  playShieldSound()
  
  // 啟用無敵護盾
  shieldActive.value = true
  shieldTimeLeft.value = 5
  
  // 清理先前的計時器
  if (shieldTimer) clearTimeout(shieldTimer)
  if (shieldCountdownInterval) clearInterval(shieldCountdownInterval)
  
  // 5 秒無敵倒數計時器
  shieldCountdownInterval = setInterval(() => {
    if (shieldTimeLeft.value > 1) {
      shieldTimeLeft.value -= 1
    } else {
      shieldTimeLeft.value = 0
      if (shieldCountdownInterval) {
        clearInterval(shieldCountdownInterval)
        shieldCountdownInterval = null
      }
    }
  }, 1000) as unknown as number

  shieldTimer = setTimeout(() => {
    shieldActive.value = false
    shieldTimer = null
  }, 5000) as unknown as number
}

// 百分慶祝太陽特效
const showSunCelebration = ref(false)
const celebrationKey = ref(0)  // 每次觸發遞增，強制 Vue 重新掛載元件
const isSpecialCelebration = ref(false)  // true = 50分重疊太陽效果
const isOnlyBlackCelebration = ref(false)  // true = 100分只出現黑太陽效果
const celebrationText = ref('')
const celebrationScore = ref(0)
const isWhiteCelebration = ref(false)
const isOverlapBlackWhiteCelebration = ref(false)

// 動態判定當前是否處於「300~450分棉花黑夜階段」的計算屬性
const isCottonStage = computed(() => {
  if (score.value < 300) return false
  const cycleOffset = score.value % 300
  // 300~440, 600~740... 等 150分長度區間為棉花黑夜，cycleOffset 介於 0 至 140 之間
  return cycleOffset >= 0 && cycleOffset < 150
})

let celebrationTimer: number | null = null

function triggerSunCelebration(special = false, onlyBlack = false, isWhite = false, isOverlapBlackWhite = false) {
  // 清掉上一個 timer（若還在進行中）
  if (celebrationTimer) clearTimeout(celebrationTimer)
  celebrationKey.value++          // ← key 變化，強制重新建立 DOM
  isSpecialCelebration.value = special
  isOnlyBlackCelebration.value = onlyBlack
  isWhiteCelebration.value = isWhite
  isOverlapBlackWhiteCelebration.value = isOverlapBlackWhite
  
  // 鎖定當下分數與特效文字，防止 3.5 秒動畫期間被吃食物的即時分數變更影響
  celebrationScore.value = score.value
  
  if (isWhite) {
    celebrationText.value = '美白成功！✨\n你又變白了！皮膚水亮亮'
  } else if (isOverlapBlackWhite) {
    celebrationText.value = '離美白越來越近'
  } else if (onlyBlack) {
    celebrationText.value = score.value === 300 ? '你被曬黑了' : '你又被曬黑了！😱'
  } else {
    // 耀眼太陽或重疊太陽階段
    if (score.value < 300) {
      if (score.value === 150) {
        celebrationText.value = '好像出現了什麼?'
      } else if (score.value === 200) {
        celebrationText.value = '越來越明顯'
      } else if (score.value === 250) {
        celebrationText.value = '快看清楚了'
      } else {
        celebrationText.value = '太陽越來越耀眼'
      }
    } else {
      const offset = score.value % 300
      if (offset === 200) {
        celebrationText.value = '太陽再次耀眼！'
      } else if (offset === 250) {
        celebrationText.value = '小心！陽光又開始強烈了'
      } else {
        celebrationText.value = '太陽再次耀眼！'
      }
    }
  }
  
  showSunCelebration.value = true
  
  // 太陽出現時播放自訂的音效 (China.mp3)
  playSunSound()
  
  celebrationTimer = setTimeout(() => {
    showSunCelebration.value = false
    celebrationTimer = null
  }, 3500) as unknown as number
}

let gameInterval: number | null = null

function initGame() {
  speed.value = baseSpeed
  snake.value = [
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 8, y: 10 },
  ]
  direction.value = { x: 1, y: 0 }
  nextDirection.value = { x: 1, y: 0 }
  score.value = 0
  
  // 重置太陽點數與無敵護盾狀態
  sunCoins.value = 0
  shieldActive.value = false
  shieldTimeLeft.value = 0
  if (shieldTimer) {
    clearTimeout(shieldTimer)
    shieldTimer = null
  }
  if (shieldCountdownInterval) {
    clearInterval(shieldCountdownInterval)
    shieldCountdownInterval = null
  }
  
  generateFood()
}

function generateFood() {
  let newFood: { x: number; y: number }
  do {
    newFood = {
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE),
    }
  } while (snake.value.some((s) => s.x === newFood.x && s.y === newFood.y))
  food.value = newFood
}

function moveSnake() {
  if (snake.value.length === 0) return

  direction.value = { ...nextDirection.value }

  const head = snake.value[0]!
  // 撞到邊界不會死，而是從另一邊穿透出現
  const newHead = {
    x: (head.x + direction.value.x + GRID_SIZE) % GRID_SIZE,
    y: (head.y + direction.value.y + GRID_SIZE) % GRID_SIZE,
  }

  if (snake.value.some((s) => s.x === newHead.x && s.y === newHead.y)) {
    // 若日冕無敵護盾處於啟用狀態，則容許安全穿透身體，不引發遊戲結束
    if (!shieldActive.value) {
      gameOver()
      return
    }
  }

  snake.value.unshift(newHead)

  if (newHead.x === food.value.x && newHead.y === food.value.y) {
    score.value += 10
    playEatSound() // 播放吃到食物的清脆電子音效！
    let isSpecial = false
    let isOnlyBlack = false
    let isWhite = false
    let isOverlapBlackWhite = false
    let shouldTrigger = false

    // 第一輪 300 分以下
    if (score.value < 300) {
      if (score.value % 50 === 0) {
        shouldTrigger = true
        isSpecial = score.value === 150 || score.value === 200 || score.value === 250
      }
    } 
    // 300 分以上（無限故事迴圈）
    else {
      const offset = score.value % 300
      if (offset === 0) {
        // 300, 600, 900... 曬黑點
        shouldTrigger = true
        isOnlyBlack = true
      } else if (offset === 50 || offset === 100) {
        // 350, 400, 650, 700... 棉花黑夜每 50 分觸發（黑白太陽重疊）
        shouldTrigger = true
        isOverlapBlackWhite = true
      } else if (offset === 150) {
        // 450, 750, 1050... 美白成功點
        shouldTrigger = true
        isWhite = true
      } else if (offset === 200) {
        // 500, 800, 1100... 太陽再次耀眼
        shouldTrigger = true
      } else if (offset === 250) {
        // 550, 850, 1150... 陽光再次強烈
        shouldTrigger = true
        isSpecial = true
      }
    }

    if (shouldTrigger) {
      sunCoins.value += 1 // 每次觸發太陽慶祝特效（每 50 分），獲得 1 個太陽能量 ☀️
      triggerSunCelebration(isSpecial, isOnlyBlack, isWhite, isOverlapBlackWhite)
      
      // 當分數剛好達到 300 分或其倍數的曬黑週期點時，自動暫停遊戲以彈出曬黑警告畫面
      if (score.value >= 300 && score.value % 300 === 0) {
        pauseGame()
      }

      // 僅在開啟加速功能時才執行加速
      if (enableSpeedUp.value && speed.value > 50) {
        speed.value -= 15
        if (gameInterval) {
          clearInterval(gameInterval)
          gameInterval = setInterval(moveSnake, speed.value) as unknown as number
        }
      }
    }
    generateFood()
  } else {
    snake.value.pop()
  }
}

// 儲存玩家得分至本地高分榜
function saveScoreToLeaderboard() {
  const currentName = playerId.value.trim() || '無名戰神'
  const currentScore = score.value
  
  if (typeof window === 'undefined') return
  
  const saved = localStorage.getItem('snake_leaderboard')
  let boardList = []
  if (saved) {
    try {
      boardList = JSON.parse(saved)
    } catch (e) {
      console.warn('讀取歷史高分榜失敗:', e)
    }
  }
  
  // 新增本次佳績
  boardList.push({
    name: currentName,
    score: currentScore,
    date: new Date().toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })
  })
  
  // 降序排序
  boardList.sort((a: any, b: any) => b.score - a.score)
  
  // 只精確保留前 5 名最頂級的成就
  const trimmed = boardList.slice(0, 5)
  localStorage.setItem('snake_leaderboard', JSON.stringify(trimmed))
  leaderboard.value = trimmed
}

function gameOver() {
  gameStatus.value = 'gameover'
  if (gameInterval) {
    clearInterval(gameInterval)
    gameInterval = null
  }
  // 保存當前得分至本地高分排行榜！
  saveScoreToLeaderboard()
}

function startGame() {
  initGame()
  gameStatus.value = 'playing'
  gameInterval = setInterval(moveSnake, speed.value) as unknown as number
  playStartSound() // 進入遊戲時播放 start.mp3 音效！
}

function resumeGame() {
  if (gameStatus.value === 'paused') {
    gameStatus.value = 'playing'
    gameInterval = setInterval(moveSnake, speed.value) as unknown as number
    playStartSound() // 繼續遊戲時播放 start.mp3 音效！
  }
}

function pauseGame() {
  if (gameStatus.value === 'playing') {
    gameStatus.value = 'paused'
    if (gameInterval) {
      clearInterval(gameInterval)
      gameInterval = null
    }
  }
}

function restartGame() {
  startGame()
}

function handleInput(e: KeyboardEvent) {
  // 記錄被按下的實體按鍵，實作操作說明面板鍵盤亮起互動
  const rawKey = e.key.toLowerCase()
  pressedKeys.value[rawKey] = true

  // 使用者按下鍵盤進行互動時，主動解鎖與預載音效
  unlockAudio()

  if (e.key === ' ') {
    e.preventDefault()
    if (gameStatus.value === 'playing') {
      pauseGame()
    } else if (gameStatus.value === 'paused') {
      resumeGame()
    }
    return
  }

  if (gameStatus.value === 'waiting') {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(e.key)) {
      startGame()
    }
  }

  if (gameStatus.value !== 'playing') return

  const key = e.key.toLowerCase()

  // --- 太陽神殿技能商店快捷鍵 ---
  if (e.key === 'Shift') {
    e.preventDefault() // 阻止預設行為 (例如避免觸發某些瀏覽器快捷功能)
    usePeelSkill()
    return
  }
  if (key === 'q') {
    useSlowDownSkill()
    return
  }
  if (key === 'e') {
    useShieldSkill()
    return
  }

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

// 實作按鍵釋放的事件處理，熄滅虛擬按鍵的霓虹燈
function handleKeyUp(e: KeyboardEvent) {
  const rawKey = e.key.toLowerCase()
  pressedKeys.value[rawKey] = false
}

onMounted(() => {
  window.addEventListener('keydown', handleInput)
  window.addEventListener('keyup', handleKeyUp)
  
  // 若已登錄（從 Boss 戰切換過來），自動初始化音訊並恢復背景音樂
  if (playerId.value) {
    initAudioElements()
    if (backAudio && bgmEnabled.value) {
      backAudio.play().catch(() => {})
    }
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleInput)
  window.removeEventListener('keyup', handleKeyUp)
  if (gameInterval) {
    clearInterval(gameInterval)
  }
  // 釋放與清理背景音樂
  if (backAudio) {
    backAudio.pause()
    backAudio = null
  }
  // 清理慶祝計時器
  if (celebrationTimer) clearTimeout(celebrationTimer)
  // 清理無敵護盾計時器與倒數計時器
  if (shieldTimer) clearTimeout(shieldTimer)
  if (shieldCountdownInterval) clearInterval(shieldCountdownInterval)
})

const cells = computed(() => {
  const result = []
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const isSnake = snake.value.findIndex((s) => s.x === x && s.y === y)
      const isFood = food.value.x === x && food.value.y === y
      result.push({
        x,
        y,
        isSnake: isSnake !== -1,
        isSnakeHead: isSnake === 0,
        isFood,
      })
    }
  }
  return result
})
</script>

<template>
  <div class="snake-game">
    <!-- 剛進入網頁時的全黑警告遮罩 -->
    <Transition name="fade">
      <div v-if="showWarningOverlay" class="warning-overlay">
        <div class="warning-content">
          <div class="sunglasses-icon">🕶️</div>
          <p class="warning-text">為避免陽光照射，請戴上墨鏡遊玩</p>
          <p class="volume-warning-text">🔊 貼心提醒：進入後將播放背景音樂，請注意音量大小</p>
          <button class="warning-btn" @click="closeWarningOverlay">
            戴上墨鏡 😎 進入遊戲
          </button>
        </div>
      </div>
    </Transition>

    <!-- ⚔️ 登錄太陽神殿玩家 ID 輸入遮罩 -->
    <Transition name="fade">
      <div v-if="showIdOverlay" class="warning-overlay id-input-overlay">
        <div class="warning-content id-content">
          <div class="sunglasses-icon">⚔️</div>
          <p class="warning-text">登錄太陽神殿</p>
          <p class="volume-warning-text">請輸入您的玩家 ID 以登載歷史功勳紀錄</p>
          <div class="id-input-wrapper">
            <input
              type="text"
              v-model="tempPlayerId"
              placeholder="輸入您的玩家 ID..."
              class="id-input-field"
              @keydown.enter="submitPlayerId"
              maxlength="12"
            />
            <!-- 未來科技感的四角定位裝飾線 -->
            <span class="tech-corner top-left"></span>
            <span class="tech-corner top-right"></span>
            <span class="tech-corner bottom-left"></span>
            <span class="tech-corner bottom-right"></span>
          </div>
          <button class="warning-btn submit-id-btn" @click="submitPlayerId">
            確認登錄 ⚔️
          </button>
        </div>
      </div>
    </Transition>

    <!-- 🏆 太陽神殿高分榜全螢幕彈窗遮罩 -->
    <Transition name="fade">
      <div v-if="showLeaderboardOverlay" class="warning-overlay leaderboard-overlay" @click.self="showLeaderboardOverlay = false">
        <div class="warning-content leaderboard-dialog">
          <div class="sunglasses-icon rank-crown">🏆</div>
          <p class="warning-text">太陽神殿高分榜</p>
          <p class="volume-warning-text">記載前五名至高戰功的英雄殿堂</p>
          
          <table class="score-table popup-table">
            <thead>
              <tr>
                <th class="th-rank">排名</th>
                <th class="th-player">玩家 ID</th>
                <th class="th-score">最高分</th>
                <th class="th-date">登錄日期</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(entry, index) in leaderboard" :key="index" :class="'rank-' + (index + 1)">
                <td class="rank-num">
                  <span class="rank-badge">{{ index + 1 }}</span>
                </td>
                <td class="player-name">{{ entry.name }}</td>
                <td class="score-val">{{ entry.score }}</td>
                <td class="score-date">{{ entry.date || '--/--' }}</td>
              </tr>
              <tr v-if="leaderboard.length === 0">
                <td colspan="4" class="no-records">
                  <span class="no-records-text">暫無神殿登錄紀錄 🌌</span>
                </td>
              </tr>
            </tbody>
          </table>
          
          <button class="warning-btn close-leaderboard-btn" @click="showLeaderboardOverlay = false">
            離開殿堂 ⚔️
          </button>
        </div>
      </div>
    </Transition>
    <!-- 主要佈局：棋盤 + 右側說明面板 -->
    <div class="game-layout">
      <!-- 左側：工具列 + 棋盤 -->
      <div class="header">
        <!-- 工具列：分數 + 整合型設定選單 -->
        <div class="toolbar">
          <div class="score">分數: {{ score }}</div>
          <div class="score sun-energy-bar" title="太陽能量：每 50 分特效可獲得 1 ☀️">
            ☀️ 太陽能量: <span class="sun-coin-count">{{ sunCoins }}</span>
          </div>
          
          <button
            class="settings-btn boss-mode-btn"
            @click="emit('switch-mode')"
            title="切換至 Boss 戰模式"
          >
            <span class="settings-btn-icon">⚔️</span>Boss 戰
          </button>

          <button
            class="settings-btn leaderboard-btn"
            :class="{ active: showLeaderboardOverlay }"
            @click="toggleLeaderboard"
            title="神殿高分榜"
          >
            <span class="settings-btn-icon">🏆</span>高分榜
          </button>

          <div class="settings-container">
            <button
              class="settings-btn"
              :class="{ active: showSettings }"
              @click="toggleSettings"
              title="遊戲設定"
            >
              <span class="settings-btn-icon">⚙️</span>設定
            </button>
            
            <!-- 點擊選單外部自動關閉的隱形背景遮罩 -->
            <div v-if="showSettings" class="settings-backdrop" @click="showSettings = false"></div>
            
            <!-- 高質感毛玻璃下拉設定選單 -->
            <Transition name="slide-up">
              <div v-if="showSettings" class="settings-dropdown">
                <div class="settings-dropdown-header">⚙️ 遊戲設定</div>
                
                <div class="settings-dropdown-body">
                  <!-- 網格線設定 -->
                  <div class="settings-row">
                    <div class="settings-row-info">
                      <span class="settings-row-title">網格線顯示</span>
                      <span class="settings-row-desc">顯示或隱藏棋盤背景格線</span>
                    </div>
                    <button
                      id="toggle-grid-btn"
                      class="settings-toggle-btn"
                      :class="{ active: showGrid }"
                      @click="toggleGrid"
                    >
                      {{ showGrid ? 'ON' : 'OFF' }}
                    </button>
                  </div>
                  
                  <!-- 加速設定 -->
                  <div class="settings-row">
                    <div class="settings-row-info">
                      <span class="settings-row-title">高分加速機制</span>
                      <span class="settings-row-desc">每 100 分時逐步提升速度</span>
                    </div>
                    <button
                      id="toggle-speed-btn"
                      class="settings-toggle-btn speed-toggle"
                      :class="{ active: enableSpeedUp }"
                      @click="toggleSpeedUp"
                    >
                      {{ enableSpeedUp ? 'ON' : 'OFF' }}
                    </button>
                  </div>
                  
                  <!-- 背景音樂 (BGM) 設定 -->
                  <div class="settings-row">
                    <div class="settings-row-info">
                      <span class="settings-row-title">背景音樂 (BGM)</span>
                      <span class="settings-row-desc">開關並調整背景音樂 volume</span>
                    </div>
                    <button
                      id="toggle-bgm-btn"
                      class="settings-toggle-btn sound-toggle"
                      :class="{ active: bgmEnabled }"
                      @click="toggleBgm"
                    >
                      {{ bgmEnabled ? 'ON' : 'OFF' }}
                    </button>
                  </div>
                  <!-- 背景音樂音量滑桿 -->
                  <div class="settings-volume-row">
                    <span class="volume-label">BGM 音量: {{ Math.round(bgmVolume * 100) }}%</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      v-model.number="bgmVolume"
                      class="volume-slider bgm-slider"
                      @input="unlockAudio"
                    />
                  </div>

                  <!-- 遊戲音效 (SFX) 設定 -->
                  <div class="settings-row">
                    <div class="settings-row-info">
                      <span class="settings-row-title">遊戲音效 (SFX)</span>
                      <span class="settings-row-desc">開關並調整吃食物與慶祝音效</span>
                    </div>
                    <button
                      id="toggle-sfx-btn"
                      class="settings-toggle-btn sound-toggle"
                      :class="{ active: sfxEnabled }"
                      @click="toggleSfx"
                    >
                      {{ sfxEnabled ? 'ON' : 'OFF' }}
                    </button>
                  </div>
                  <!-- 遊戲音效音量滑桿 -->
                  <div class="settings-volume-row">
                    <span class="volume-label">SFX 音量: {{ Math.round(sfxVolume * 100) }}%</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      v-model.number="sfxVolume"
                      class="volume-slider sfx-slider"
                      @input="unlockAudio"
                    />
                  </div>

                  <!-- 啟動音效 (Start) 設定 -->
                  <div class="settings-row">
                    <div class="settings-row-info">
                      <span class="settings-row-title">啟動音效 (Start)</span>
                      <span class="settings-row-desc">開關並調整開始與繼續遊戲音效</span>
                    </div>
                    <button
                      id="toggle-start-btn"
                      class="settings-toggle-btn sound-toggle"
                      :class="{ active: startEnabled }"
                      @click="toggleStart"
                    >
                      {{ startEnabled ? 'ON' : 'OFF' }}
                    </button>
                  </div>
                  <!-- 啟動音效音量滑桿 -->
                  <div class="settings-volume-row">
                    <span class="volume-label">啟動音量: {{ Math.round(startVolume * 100) }}%</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      v-model.number="startVolume"
                      class="volume-slider start-slider"
                      @input="unlockAudio"
                    />
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </div>
        <!-- 遊戲棋盤 -->
        <div class="game-board" :class="{ 'show-grid': showGrid, 'shield-active-board': shieldActive }">
          <div
            v-for="cell in cells"
            :key="`${cell.x}-${cell.y}`"
            class="cell"
            :class="{
              food: cell.isFood && !isCottonStage,
              cotton: cell.isFood && isCottonStage,
              snake: cell.isSnake,
              'snake-head': cell.isSnakeHead,
            }"
          ></div>

          <!-- 護盾剩餘時間提示 Overlay -->
          <Transition name="fade">
            <div v-if="shieldActive" class="shield-status-overlay">
              🛡️ 日冕護盾中: {{ shieldTimeLeft }}秒
            </div>
          </Transition>

          <!-- 遊戲狀態 Overlay (精準蓋在棋盤正中間) -->
          <div v-if="gameStatus === 'waiting'" class="overlay">
            <p>按方向鍵開始遊戲</p>
          </div>
          <div v-if="gameStatus === 'paused'" class="overlay" :class="{ 'blackout-overlay': isCottonStage }">
            <p class="overlay-title">{{ isCottonStage ? '你曬黑了' : '暫停' }}</p>
            <p class="overlay-sub">{{ isCottonStage ? '請收集棉花賺錢，去做美白' : '按空白鍵繼續' }}</p>
            <p v-if="isCottonStage" class="overlay-hint">按空白鍵繼續收集</p>
          </div>
          <div v-if="gameStatus === 'gameover'" class="overlay">
            <p class="overlay-title">遊戲結束</p>
            <p class="overlay-sub">最終分數: {{ score }}</p>
            <div class="gameover-actions">
              <button @click="restartGame" class="gameover-btn">重新開始</button>
              <button @click="toggleLeaderboard" class="gameover-btn secondary-btn">查看高分榜 🏆</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右側：說明面板 -->
      <aside class="side-panel">
        <!-- 遊戲說明 -->
        <div class="info-block">
          <h2 class="info-title">🐍 遊戲說明</h2>
          <ul class="info-list">
            <li>吃食物得分 (每個 +10分) 🍎</li>
            <li>撞邊界會從相反側穿透出現 🌀</li>
            <li>撞到自己的身體即遊戲結束 💀</li>
            <li>每得 100 分，蛇的前進速度會加快 📈</li>
          </ul>
        </div>

        <!-- 操作說明 -->
        <div class="info-block">
          <h2 class="info-title">🎮 操作說明</h2>
          <div class="controls">
            <!-- 方向鍵圖示 -->
            <div class="key-group">
              <div class="key-row">
                <kbd class="key" :class="{ pressed: pressedKeys['w'] || pressedKeys['arrowup'] }">W</kbd>
              </div>
              <div class="key-row">
                <kbd class="key" :class="{ pressed: pressedKeys['a'] || pressedKeys['arrowleft'] }">A</kbd>
                <kbd class="key" :class="{ pressed: pressedKeys['s'] || pressedKeys['arrowdown'] }">S</kbd>
                <kbd class="key" :class="{ pressed: pressedKeys['d'] || pressedKeys['arrowright'] }">D</kbd>
              </div>
              <p class="key-label" :class="{ blink: gameStatus === 'waiting' }">
                {{ gameStatus === 'waiting' ? '▶ 按方向鍵開始' : '或方向鍵控制移動' }}
              </p>
            </div>
            
            <!-- 暫停 / 繼續 -->
            <div class="key-group">
              <div class="key-row">
                <kbd class="key wide" :class="{ pressed: pressedKeys[' '] }">Space</kbd>
              </div>
              <p class="key-label" :class="{ 'blink-paused': gameStatus === 'paused' }">
                {{ gameStatus === 'paused' ? '⏸ 暫停中 (按空白鍵繼續)' : '遊戲暫停 / 繼續' }}
              </p>
            </div>
          </div>
        </div>

        <!-- ⛩️ 太陽神殿（技能兌換商店） -->
        <div class="info-block sun-temple">
          <h2 class="info-title">⛩️ 太陽神殿</h2>
          <div class="temple-shop">
            <!-- 技能 1: 太陽蛻皮 (消耗 1 ☀️ / Shift) -->
            <div class="shop-item" :class="{ 'affordable': sunCoins >= 1 }">
              <div class="shop-item-info">
                <span class="shop-item-title">🐍 太陽蛻皮</span>
                <span class="shop-item-desc">縮短身體 30%</span>
              </div>
              <button
                class="shop-buy-btn"
                :disabled="sunCoins < 1 || gameStatus !== 'playing'"
                @click="usePeelSkill"
                title="太陽蛻皮 (快捷鍵: Shift)"
              >
                <span class="cost">1 ☀️</span>
                <kbd class="shop-kbd">Shift</kbd>
              </button>
            </div>

            <!-- 技能 2: 烈日緩速 (消耗 2 ☀️ / Q) -->
            <div class="shop-item" :class="{ 'affordable': sunCoins >= 2 }">
              <div class="shop-item-info">
                <span class="shop-item-title">⏳ 烈日緩速</span>
                <span class="shop-item-desc">移動間隔 +50ms</span>
              </div>
              <button
                class="shop-buy-btn"
                :disabled="sunCoins < 2 || gameStatus !== 'playing'"
                @click="useSlowDownSkill"
                title="烈日緩速 (快捷鍵: Q)"
              >
                <span class="cost">2 ☀️</span>
                <kbd class="shop-kbd">Q</kbd>
              </button>
            </div>

            <!-- 技能 3: 日冕護盾 (消耗 3 ☀️ / E) -->
            <div class="shop-item" :class="{ 'affordable': sunCoins >= 3 }">
              <div class="shop-item-info">
                <span class="shop-item-title">🛡️ 日冕護盾</span>
                <span class="shop-item-desc">5秒無敵穿透身體</span>
              </div>
              <button
                class="shop-buy-btn"
                :disabled="sunCoins < 3 || gameStatus !== 'playing'"
                @click="useShieldSkill"
                title="日冕護盾 (快捷鍵: E)"
              >
                <span class="cost">3 ☀️</span>
                <kbd class="shop-kbd">E</kbd>
              </button>
            </div>
          </div>
        </div>

      </aside>
    </div>

    <!-- 遊戲狀態 Overlay 已移入 .game-board 內部以精準在地圖中央對齊 -->
    <!-- 百分慶祝：全螢幕太陽出現 -->
    <Transition name="sun-burst">
      <div v-if="showSunCelebration" :key="celebrationKey" class="sun-celebration">
        <!-- 太陽容器：用來重疊不同樣式的太陽 -->
        <div class="sun-container">
          <!-- 普通太陽（當不是黑太陽、白太陽、黑白重疊時顯示） -->
          <img
            v-if="!isOnlyBlackCelebration && !isWhiteCelebration && !isOverlapBlackWhiteCelebration"
            src="/sun.png"
            class="sun-burst-img"
            alt="太陽"
          />
          <!-- 50分特殊重疊太陽 -->
          <img
            v-if="isSpecialCelebration"
            src="/sun_black.png"
            class="sun-black-img"
            alt="黑太陽殘影"
          />
          <!-- 300分純黑太陽 -->
          <img
            v-if="isOnlyBlackCelebration"
            src="/sun_black.png"
            class="sun-black-only-img"
            alt="黑太陽"
          />
          <!-- 450分美白成功白色太陽 -->
          <img
            v-if="isWhiteCelebration"
            src="/sun_white.png"
            class="sun-white-img"
            alt="白色太陽"
          />
          <!-- 棉花黑夜黑白太陽重疊 -->
          <img
            v-if="isOverlapBlackWhiteCelebration"
            src="/sun_white.png"
            class="sun-white-img"
            alt="白色太陽"
          />
          <img
            v-if="isOverlapBlackWhiteCelebration"
            src="/sun_black.png"
            class="sun-black-img"
            alt="黑太陽殘影"
          />
        </div>
        <div class="sun-score-text">{{ celebrationScore }}</div>
        <div class="sun-congrats">
          {{ celebrationText }}
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700&display=swap');

/* 淡入淡出 Transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ===== 剛進入網頁的全黑警告遮罩 ===== */
.warning-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: #000000;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 黑色日冕的光暈底色背景 */
  background-image: radial-gradient(
    circle at center,
    rgba(255, 255, 255, 0.05) 0%,
    rgba(0, 0, 0, 1) 70%
  );
}

.warning-content {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 40px;
}

.sunglasses-icon {
  font-size: 80px;
  filter: drop-shadow(0 0 20px rgba(255, 255, 255, 0.3));
  animation: floatIcon 3s ease-in-out infinite;
}

.warning-text {
  font-size: clamp(20px, 4vw, 32px);
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 2px;
  margin: 0;
  text-shadow:
    0 0 10px rgba(255, 255, 255, 0.6),
    0 0 20px rgba(255, 255, 255, 0.2);
  line-height: 1.5;
}

.warning-btn {
  background: linear-gradient(135deg, #1f2937, #111827);
  color: #00ff88;
  border: 2px solid rgba(0, 255, 136, 0.4);
  padding: 16px 36px;
  font-size: clamp(16px, 2.5vw, 20px);
  font-weight: 700;
  font-family: 'Orbitron', sans-serif;
  border-radius: 9999px;
  cursor: pointer;
  box-shadow:
    0 0 15px rgba(0, 255, 136, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  transition: all 0.3s ease;
  letter-spacing: 1px;
}

.warning-btn:hover {
  background: linear-gradient(135deg, #111827, #030712);
  color: #ffffff;
  border-color: #00ff88;
  transform: translateY(-3px) scale(1.05);
  box-shadow:
    0 0 25px rgba(0, 255, 136, 0.6),
    0 0 50px rgba(0, 255, 136, 0.2);
}

.warning-btn:active {
  transform: translateY(-1px) scale(1.01);
}

.volume-warning-text {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.45);
  margin: -10px 0 10px 0;
  display: flex;
  align-items: center;
  gap: 8px;
  text-shadow: 0 0 8px rgba(255, 255, 255, 0.1);
  animation: pulseVolumeWarning 2.5s ease-in-out infinite;
}

@keyframes pulseVolumeWarning {
  0%, 100% {
    opacity: 0.5;
    transform: scale(1);
  }
  50% {
    opacity: 0.95;
    color: #ffcc00;
    text-shadow: 0 0 12px rgba(255, 204, 0, 0.4);
    transform: scale(1.02);
  }
}

@keyframes floatIcon {
  0%, 100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-10px) rotate(3deg);
  }
}

.snake-game {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  /* 慶祝 overlay 需要 position: relative 作為定位參考 */
  position: relative;
  overflow: hidden;
  font-family: 'Orbitron', sans-serif;
  
  /* 優化：改用極致奢華的藏青至暗紫深邃宇宙徑向漸層 */
  background: radial-gradient(circle at 50% 50%, #0c1020 0%, #030611 100%);
}

/* 在背景深處注入兩團動態旋轉漂移的霓虹星雲，製造宏大的未來太空感 */
.snake-game::before {
  content: '';
  position: absolute;
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, rgba(0, 255, 255, 0.05) 0%, transparent 70%);
  top: -10%;
  left: -10%;
  z-index: 0;
  pointer-events: none;
  animation: auroraFlowOne 25s ease-in-out infinite alternate;
}

.snake-game::after {
  content: '';
  position: absolute;
  width: 700px;
  height: 700px;
  background: radial-gradient(circle, rgba(168, 85, 247, 0.04) 0%, transparent 70%);
  bottom: -15%;
  right: -10%;
  z-index: 0;
  pointer-events: none;
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

/* ===== 百分慶祝太陽全螢幕特效 ===== */
.sun-celebration {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: radial-gradient(
    circle at center,
    rgba(255, 220, 50, 0.35) 0%,
    rgba(255, 120, 0, 0.2) 40%,
    rgba(0, 0, 0, 0.6) 100%
  );
  pointer-events: none;
}

.sun-container {
  position: relative;
  width: min(80vw, 80vh);
  height: min(80vw, 80vh);
  display: flex;
  justify-content: center;
  align-items: center;
}

.sun-burst-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  animation: sunBurstAnim 3.5s ease-out forwards;
  filter:
    drop-shadow(0 0 40px rgba(255, 200, 0, 1))
    drop-shadow(0 0 80px rgba(255, 120, 0, 0.8))
    drop-shadow(0 0 120px rgba(255, 80, 0, 0.5));
}

.sun-black-img {
  position: absolute;
  /* 黑色太陽殘影稍微偏移，微微重疊在普通太陽上面 */
  top: 10px;
  left: 10px;
  width: 100%;
  height: 100%;
  object-fit: contain;
  /* 半透明度，讓其「微微出現在太陽上面」 */
  opacity: 0.55;
  /* 與普通太陽類似但略帶相位差、旋轉角度以及微幅抖動偏移的殘影動畫 */
  animation: sunBlackShadowAnim 3.5s ease-out forwards;
  pointer-events: none;
  /* 搭配日食神祕感，加入暗黑色光暈發光 */
  filter: drop-shadow(0 0 25px rgba(0, 0, 0, 0.85));
}

.sun-black-only-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 1; /* 100分專屬：完全不透明的大黑太陽 */
  animation: sunBurstAnim 3.5s ease-out forwards; /* 使用大太陽的爆炸旋轉動畫 */
  pointer-events: none;
  /* 黑色太陽專屬的強烈黑色日冕光暈，帶有微亮銀白邊 */
  filter:
    drop-shadow(0 0 30px rgba(0, 0, 0, 1))
    drop-shadow(0 0 60px rgba(255, 255, 255, 0.35))
    drop-shadow(0 0 100px rgba(100, 100, 100, 0.5));
}

.sun-score-text {
  position: absolute;
  font-size: clamp(48px, 10vw, 120px);
  font-weight: 700;
  color: #fff7c0;
  text-shadow:
    0 0 20px #ffcc00,
    0 0 40px #ff8800,
    0 0 80px rgba(255, 150, 0, 0.6);
  animation: scorePop 3.5s ease-out forwards;
  letter-spacing: 4px;
}

/* 恭喜文字：顯示在分數下方 */
.sun-congrats {
  position: absolute;
  top: calc(50% + 60px);
  font-size: clamp(16px, 3vw, 28px);
  font-weight: 700;
  color: #fff7c0;
  letter-spacing: 3px;
  text-shadow:
    0 0 12px #ffcc00,
    0 0 24px #ff8800;
  animation: labelFade 3.5s ease-out forwards;
  white-space: pre-line;
  text-align: center;
  line-height: 1.4;
}

/* 太陽爆炸旋轉動畫 */
@keyframes sunBurstAnim {
  0% {
    transform: scale(0.1) rotate(-180deg);
    opacity: 0;
  }
  30% {
    transform: scale(1.15) rotate(15deg);
    opacity: 1;
  }
  60% {
    transform: scale(0.95) rotate(-5deg);
    opacity: 1;
  }
  80% {
    transform: scale(1) rotate(0deg);
    opacity: 1;
  }
  100% {
    transform: scale(1.05) rotate(3deg);
    opacity: 0;
  }
}

/* 黑色太陽殘影動畫：比普通太陽略帶偏移、旋轉與微小的抖動，營造立體殘影與日食能量波動 */
@keyframes sunBlackShadowAnim {
  0% {
    transform: scale(0.1) rotate(-185deg) translate(0, 0);
    opacity: 0;
  }
  30% {
    /* 爆炸至最大時，位置微調偏移以顯現殘影 */
    transform: scale(1.17) rotate(18deg) translate(6px, 6px);
    opacity: 0.65;
  }
  60% {
    /* 中途收縮時，略微反向抖動 */
    transform: scale(0.97) rotate(-7deg) translate(-2px, -2px);
    opacity: 0.65;
  }
  80% {
    transform: scale(1.02) rotate(2deg) translate(4px, 4px);
    opacity: 0.55;
  }
  100% {
    transform: scale(1.07) rotate(4deg) translate(3px, 3px);
    opacity: 0;
  }
}

/* 分數強調動畫 */
@keyframes scorePop {
  0%   { transform: scale(0.3); opacity: 0; }
  40%  { transform: scale(1.3); opacity: 1; }
  70%  { transform: scale(1);   opacity: 1; }
  100% { transform: scale(1.1); opacity: 0; }
}

/* LEVEL UP 文字淡入淡出 */
@keyframes labelFade {
  0%   { opacity: 0; transform: translateY(20px); }
  30%  { opacity: 1; transform: translateY(0); }
  80%  { opacity: 1; }
  100% { opacity: 0; }
}

/* Vue Transition 動畫 */
.sun-burst-enter-active,
.sun-burst-leave-active {
  transition: opacity 0.2s;
}
.sun-burst-enter-from,
.sun-burst-leave-to {
  opacity: 0;
}

/* 主佈局：棋盤在左，說明面板在右 */
.game-layout {
  display: flex;
  align-items: flex-start;
  gap: 28px;
  position: relative;
  z-index: 2; /* 確保遊戲主要視窗覆蓋在背景星雲之上 */
}

.header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

/* ===== 右側說明面板 ===== */
.side-panel {
  width: 220px;
  display: flex;
  flex-direction: column;
  gap: 12px; /* 稍微拉開區塊間距 */
  /* 與棋盤頂部對齊，稍微提升頂端位置 */
  padding-top: 40px;
}

/* 每個說明區塊：極致毛玻璃流光卡片 */
.info-block {
  background: rgba(10, 16, 32, 0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-top: 1px solid rgba(0, 255, 255, 0.25); /* 頂部高光細線 */
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.info-block:hover {
  border-top-color: rgba(0, 255, 255, 0.5);
  border-color: rgba(0, 255, 255, 0.15);
  box-shadow:
    0 15px 40px rgba(0, 0, 0, 0.5),
    0 0 15px rgba(0, 255, 255, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  transform: translateY(-2px);
}

/* 說明標題：加上科技感霓虹切割線 */
.info-title {
  color: #00ffff;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 1.5px;
  margin: 0 0 10px 0;
  text-shadow: 0 0 8px rgba(0, 255, 255, 0.6);
  border-bottom: 1px solid rgba(0, 255, 255, 0.1);
  padding-bottom: 6px;
  position: relative;
}

/* 青色科技定位飾條 */
.info-title::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  width: 25px;
  height: 2px;
  background: #00ffff;
  box-shadow: 0 0 6px #00ffff;
}

/* 遊戲說明清單 */
.info-list {
  margin: 0;
  padding-left: 16px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  font-family: sans-serif;
  line-height: 1.7; /* 稍微縮小行高 */
  letter-spacing: 0;
}

/* 操作說明鍵盤區 */
.controls {
  display: flex;
  flex-direction: column;
  gap: 10px; /* 縮小控制項間距 */
}

.key-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.key-row {
  display: flex;
  gap: 4px;
  justify-content: center;
}

/* 鍵盤按鍵外觀：3D 晶體亮麗質感 */
.key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 35px;
  height: 35px;
  background: linear-gradient(180deg, rgba(20, 30, 50, 0.85), rgba(8, 12, 24, 0.95));
  border: 1px solid rgba(0, 255, 255, 0.2);
  border-bottom: 3px solid rgba(0, 200, 255, 0.4);
  border-radius: 6px;
  color: rgba(160, 216, 239, 0.6);
  font-size: 13px;
  font-family: 'Orbitron', sans-serif;
  font-weight: 700;
  letter-spacing: 0;
  box-shadow:
    0 4px 10px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

/* 按鍵實體按下時的同步亮燈與下壓回饋 */
.key.pressed {
  color: #ffffff;
  background: linear-gradient(180deg, rgba(0, 255, 255, 0.25), rgba(0, 150, 255, 0.15));
  border-color: #00ffff;
  border-bottom-width: 1px; /* 下壓感 */
  transform: translateY(2px);
  text-shadow: 0 0 8px #00ffff;
  box-shadow:
    0 0 15px rgba(0, 255, 255, 0.6),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.key.wide {
  width: 82px;
  font-size: 10px;
  letter-spacing: 1px;
}

.key-label {
  margin: 4px 0 0;
  font-size: 11px;
  font-family: sans-serif;
  color: rgba(255, 255, 255, 0.45);
  letter-spacing: 0;
}

/* 計分表格 */
.score-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-family: sans-serif;
  color: rgba(255, 255, 255, 0.7);
  letter-spacing: 0;
}

.score-table tr {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.score-table td {
  padding: 6px 2px;
  vertical-align: middle;
}

.score-val {
  text-align: right;
  color: #00ffff;
  font-weight: 700;
  font-family: 'Orbitron', sans-serif;
  font-size: 11px;
  text-shadow: 0 0 6px rgba(0, 255, 255, 0.5);
}

/* 食物小圓點（表格內裝飾） */
.food-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  background: radial-gradient(circle at 35% 35%, #fff7e0, #ffaa00, #ff6600);
  border-radius: 50%;
  vertical-align: middle;
  box-shadow: 0 0 6px #ff8800;
}

/* 狀態提示區塊 */
.start-hint {
  text-align: center;
  border-color: rgba(168, 85, 247, 0.3);
}

.start-hint p {
  margin: 0;
  color: rgba(255, 255, 255, 0.8);
  font-size: 13px;
  letter-spacing: 1px;
}

.start-hint.gameover p {
  color: rgba(255, 100, 100, 0.9);
}

.final-score {
  color: #00ffff !important;
  font-size: 16px !important;
  margin-top: 6px !important;
  text-shadow: 0 0 8px rgba(0, 255, 255, 0.6);
}

/* 閃爍動畫 */
.blink {
  animation: blink 1.2s ease-in-out infinite;
  color: #a855f7 !important;
  text-shadow: 0 0 8px rgba(168, 85, 247, 0.6);
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* 暫停閃爍動畫 */
.blink-paused {
  animation: blinkPaused 1.2s ease-in-out infinite;
  color: #c084fc !important;
  text-shadow: 0 0 8px rgba(168, 85, 247, 0.6);
}

@keyframes blinkPaused {
  0%, 100% {
    opacity: 1;
    text-shadow: 0 0 8px rgba(168, 85, 247, 0.6);
  }
  50% {
    opacity: 0.35;
    text-shadow: 0 0 2px rgba(168, 85, 247, 0.2);
  }
}

/* 分數與設定按鈕的工具列 */
.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  position: relative;
}

/* 設定容器，用於 absolute 下拉定位 */
.settings-container {
  position: relative;
}

/* 隱形全螢幕遮罩，用於點擊外部自動關閉 */
.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 98;
  background: transparent;
  cursor: default;
}

/* ⚙️ 設定按鈕 */
.settings-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.6);
  color: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(0, 255, 255, 0.2);
  padding: 10px 20px;
  font-size: 15px;
  font-family: 'Orbitron', sans-serif;
  border-radius: 6px;
  cursor: pointer;
  letter-spacing: 1.5px;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.settings-btn-icon {
  font-size: 16px;
  transition: transform 0.5s ease;
}

.settings-btn:hover {
  color: #00ffff;
  border-color: rgba(0, 255, 255, 0.5);
  box-shadow: 0 0 15px rgba(0, 255, 255, 0.2);
  transform: translateY(-1px);
}

.settings-btn:hover .settings-btn-icon {
  transform: rotate(45deg);
}

.settings-btn.active {
  color: #00ffff;
  border-color: rgba(0, 255, 255, 0.8);
  background: rgba(10, 25, 45, 0.8);
  box-shadow:
    0 0 12px rgba(0, 255, 255, 0.4),
    0 0 25px rgba(0, 255, 255, 0.15);
  text-shadow: 0 0 8px rgba(0, 255, 255, 0.6);
}

.settings-btn.active .settings-btn-icon {
  transform: rotate(90deg);
}

/* 高質感毛玻璃下拉設定選單 */
.settings-dropdown {
  position: absolute;
  top: calc(100% + 12px);
  right: 0;
  z-index: 99;
  width: 300px;
  background: rgba(10, 15, 30, 0.95);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(0, 255, 255, 0.25);
  border-radius: 8px;
  padding: 16px;
  box-shadow:
    0 10px 40px rgba(0, 0, 0, 0.85),
    0 0 25px rgba(0, 255, 255, 0.12);
}

.settings-dropdown-header {
  font-size: 14px;
  font-weight: 700;
  color: #00ffff;
  letter-spacing: 1.5px;
  text-shadow: 0 0 8px rgba(0, 255, 255, 0.5);
  border-bottom: 1px solid rgba(0, 255, 255, 0.15);
  padding-bottom: 10px;
  margin-bottom: 12px;
  text-align: left;
}

.settings-dropdown-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.settings-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.settings-row:last-child {
  border-bottom: none;
}

.settings-row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}

.settings-row-title {
  font-size: 13px;
  font-weight: 700;
  color: #ffffff;
}

.settings-row-desc {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  font-family: sans-serif;
  line-height: 1.3;
}

/* 設定切換按鈕 */
.settings-toggle-btn {
  width: 54px;
  height: 26px;
  background: rgba(0, 0, 0, 0.6);
  color: rgba(255, 255, 255, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 9999px;
  font-size: 11px;
  font-family: 'Orbitron', sans-serif;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.25s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.settings-toggle-btn:hover {
  color: rgba(255, 255, 255, 0.7);
  border-color: rgba(255, 255, 255, 0.3);
}

/* 網格線 ON：青色發光 */
.settings-toggle-btn.active {
  color: #00ffff;
  border-color: rgba(0, 255, 255, 0.6);
  box-shadow:
    0 0 8px rgba(0, 255, 255, 0.4),
    0 0 16px rgba(0, 255, 255, 0.15);
  text-shadow: 0 0 6px #00ffff;
  background: rgba(0, 255, 255, 0.08);
}

/* 加速 ON：橘黃色發光 */
.settings-toggle-btn.speed-toggle.active {
  color: #ffaa00;
  border-color: rgba(255, 170, 0, 0.6);
  box-shadow:
    0 0 8px rgba(255, 170, 0, 0.4),
    0 0 16px rgba(255, 170, 0, 0.15);
  text-shadow: 0 0 6px #ffaa00;
  background: rgba(255, 170, 0, 0.08);
}

/* 音效 ON：冰綠色發光 */
.settings-toggle-btn.sound-toggle.active {
  color: #00ff88;
  border-color: rgba(0, 255, 136, 0.6);
  box-shadow:
    0 0 8px rgba(0, 255, 136, 0.4),
    0 0 16px rgba(0, 255, 136, 0.15);
  text-shadow: 0 0 6px #00ff88;
  background: rgba(0, 255, 136, 0.08);
}

/* 音量調整列樣式 */
.settings-volume-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0 10px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.settings-volume-row:last-child {
  border-bottom: none;
}

.volume-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  font-family: sans-serif;
  text-align: left;
}

/* 高質感科技感滑桿樣式 */
.volume-slider {
  -webkit-appearance: none;
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 9999px;
  outline: none;
  transition: background 0.3s ease;
}

/* 背景音樂滑桿 */
.volume-slider.bgm-slider::-webkit-slider-runnable-track {
  width: 100%;
  height: 4px;
  cursor: pointer;
}

.volume-slider.bgm-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  height: 12px;
  width: 12px;
  border-radius: 50%;
  background: #00ffff;
  cursor: pointer;
  margin-top: -4px;
  box-shadow: 0 0 6px rgba(0, 255, 255, 0.8);
  transition: transform 0.15s ease, background-color 0.15s ease;
}

.volume-slider.bgm-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  background: #ffffff;
  box-shadow: 0 0 10px rgba(0, 255, 255, 1);
}

/* 遊戲音效滑桿 */
.volume-slider.sfx-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  height: 12px;
  width: 12px;
  border-radius: 50%;
  background: #00ff88;
  cursor: pointer;
  margin-top: -4px;
  box-shadow: 0 0 6px rgba(0, 255, 136, 0.8);
  transition: transform 0.15s ease, background-color 0.15s ease;
}

.volume-slider.sfx-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  background: #ffffff;
  box-shadow: 0 0 10px rgba(0, 255, 136, 1);
}

/* 啟動音效滑桿 */
.volume-slider.start-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  height: 12px;
  width: 12px;
  border-radius: 50%;
  background: #a855f7;
  cursor: pointer;
  margin-top: -4px;
  box-shadow: 0 0 6px rgba(168, 85, 247, 0.8);
  transition: transform 0.15s ease, background-color 0.15s ease;
}

.volume-slider.start-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  background: #ffffff;
  box-shadow: 0 0 10px rgba(168, 85, 247, 1);
}

/* 下拉選單展開動畫 */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}

.score {
  color: #00ffff;
  font-size: 24px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 3px;
  text-shadow:
    0 0 10px rgba(0, 255, 255, 0.8),
    0 0 20px rgba(0, 255, 255, 0.4);
  background: rgba(10, 16, 32, 0.8);
  backdrop-filter: blur(12px);
  padding: 12px 24px;
  border: 1px solid rgba(0, 255, 255, 0.35);
  border-radius: 8px;
  position: relative;
  overflow: hidden;
  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.5),
    inset 0 0 15px rgba(0, 255, 255, 0.05);
  transition: all 0.3s ease;
}

/* 加上儀表板定位小裝飾 */
.score::before {
  content: '■';
  position: absolute;
  top: 4px;
  left: 8px;
  font-size: 8px;
  color: rgba(0, 255, 255, 0.5);
}

/* 科幻垂直循環掃描線 */
.score::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 100%;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 255, 255, 0.04) 50%,
    transparent 100%
  );
  pointer-events: none;
  animation: scoreboardScan 3s linear infinite;
}

@keyframes scoreboardScan {
  0% { transform: translateY(-100%); }
  100% { transform: translateY(100%); }
}

.game-board {
  display: grid;
  grid-template-columns: repeat(20, 30px);
  grid-template-rows: repeat(20, 30px);
  border: 2px solid #1a3a5a;
  background: linear-gradient(rgba(10, 15, 30, 0.95), rgba(5, 10, 20, 0.95));
  border-radius: 8px;
  /* 讓 ::after 格線層可以絕對定位 */
  position: relative;
  box-shadow:
    0 0 50px rgba(0, 150, 255, 0.15),
    inset 0 0 100px rgba(0, 0, 0, 0.8),
    0 0 1px 3px rgba(0, 200, 255, 0.3);
}

/* 格線疊加層：用 ::after 覆蓋整個棋盤，不影響背景順序 */
.game-board.show-grid::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 8px;
  pointer-events: none;
  background:
    repeating-linear-gradient(
      to right,
      rgba(255, 255, 255, 0.12) 0px,
      rgba(255, 255, 255, 0.12) 1px,
      transparent 1px,
      transparent 30px
    ),
    repeating-linear-gradient(
      to bottom,
      rgba(255, 255, 255, 0.12) 0px,
      rgba(255, 255, 255, 0.12) 1px,
      transparent 1px,
      transparent 30px
    );
}

.cell {
  width: 30px;
  height: 30px;
}

.food {
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  /* 讓太陽可以超出 30px 格子範圍顯示 */
  overflow: visible;
}

/* 光暈光圈層（保留脈衝動畫） */
.food::before {
  content: '';
  position: absolute;
  width: 52px;
  height: 52px;
  background: radial-gradient(circle, rgba(255, 200, 50, 0.5) 0%, transparent 70%);
  animation: sunPulse 2s ease-in-out infinite;
  border-radius: 50%;
}

/* 主體：改用 sun.png 圖片 */
.food::after {
  content: '';
  width: 40px;
  height: 40px;
  background-image: url('/sun.png');
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
  animation: sunPulse 2s ease-in-out infinite;
  /* 讓圖片也帶點發光感 */
  filter: drop-shadow(0 0 8px rgba(255, 180, 0, 0.9)) drop-shadow(0 0 18px rgba(255, 100, 0, 0.6));
}

@keyframes sunPulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.9;
  }
  50% {
    transform: scale(1.2);
    opacity: 1;
  }
}

.cotton {
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  overflow: visible;
}

/* 蓬鬆的白色微弱發光光暈 */
.cotton::before {
  content: '';
  position: absolute;
  width: 48px;
  height: 48px;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.6) 0%, transparent 70%);
  animation: cottonPulse 2.5s ease-in-out infinite;
  border-radius: 50%;
}

/* 棉花主體：高質感蓬鬆雲朵 */
.cotton::after {
  content: '☁️';
  font-size: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: cottonPulse 2.5s ease-in-out infinite;
  /* 讓棉花具有蓬鬆明亮發光感 */
  filter:
    drop-shadow(0 0 6px rgba(255, 255, 255, 1))
    drop-shadow(0 0 15px rgba(220, 240, 255, 0.7));
}

@keyframes cottonPulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.9;
  }
  50% {
    transform: scale(1.15);
    opacity: 1;
  }
}

.snake {
  /* 優化：色彩在身體裡順滑滾動的能量流動漸層 */
  background: linear-gradient(270deg, #c084fc, #9333ea, #00ffff, #7c3aed);
  background-size: 400% 400%;
  animation: snakeEnergyFlow 4s ease infinite;
  border-radius: 6px;
  box-shadow:
    0 0 10px rgba(147, 51, 234, 0.6),
    0 0 20px rgba(0, 255, 255, 0.3),
    inset 0 1px 3px rgba(255, 255, 255, 0.4);
  position: relative;
}

@keyframes snakeEnergyFlow {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

.snake::before {
  content: '';
  position: absolute;
  top: 5px;
  left: 2px;
  right: 2px;
  height: 3px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.6), transparent);
  border-radius: 2px;
}

.snake-head {
  background: radial-gradient(ellipse at 30% 30%, #ffffff 0%, #a855f7 55%, #6366f1 100%) !important;
  border-radius: 8px;
  position: relative;
  box-shadow:
    0 0 15px rgba(168, 85, 247, 0.85),
    0 0 30px rgba(0, 255, 255, 0.5),
    inset 0 2px 4px rgba(255, 255, 255, 0.5);
}

.snake-head::before,
.snake-head::after {
  content: '';
  position: absolute;
  width: 6px;
  height: 8px;
  background: linear-gradient(180deg, #fff, #1a1a2e);
  border-radius: 50%;
  top: 7px;
  box-shadow:
    0 0 8px rgba(0, 255, 255, 0.9),
    0 0 15px rgba(0, 255, 255, 0.6) !important;
}

.overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(10, 15, 30, 0.75);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  padding: 30px;
  width: 85%;
  max-width: 320px;
  border-radius: 16px;
  text-align: center;
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-top: 1px solid rgba(168, 85, 247, 0.4); /* 紫色高光頂部 */
  z-index: 10;
  box-shadow:
    0 20px 50px rgba(0, 0, 0, 0.8),
    0 0 30px rgba(168, 85, 247, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  transition: all 0.3s ease;
}

.overlay p {
  font-size: 18px;
  margin: 0;
  font-weight: 700;
  letter-spacing: 1px;
}

/* 暫停/結束主標題 */
.overlay .overlay-title {
  font-size: 26px;
  color: #c084fc;
  text-shadow: 0 0 10px rgba(168, 85, 247, 0.5);
}

/* 暫停/結束子說明 */
.overlay .overlay-sub {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
}

.overlay button {
  background: linear-gradient(135deg, #9333ea, #7c3aed);
  color: white;
  border: none;
  padding: 10px 24px;
  font-size: 16px;
  border-radius: 6px;
  cursor: pointer;
  font-family: 'Orbitron', sans-serif;
  box-shadow: 0 0 20px rgba(147, 51, 234, 0.5);
  transition: all 0.25s ease;
}

.overlay button:hover {
  box-shadow: 0 0 30px rgba(147, 51, 234, 0.8);
  transform: scale(1.05);
}

/* 300分後暫停畫面黑化效果 */
.overlay.blackout-overlay {
  background: rgba(0, 0, 0, 0.98);
  border-color: rgba(255, 255, 255, 0.15);
  box-shadow:
    0 0 50px rgba(0, 0, 0, 1),
    0 0 25px rgba(255, 255, 255, 0.08);
}

.overlay.blackout-overlay .overlay-title {
  color: #e5e7eb;
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.3);
}

.overlay.blackout-overlay .overlay-sub {
  color: #9ca3af;
}

.overlay-hint {
  font-size: 11px;
  color: #6b7280;
  margin-top: 8px;
  animation: blink 1.5s infinite;
}

/* 白色太陽聖潔發光樣式 */
.sun-white-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 1;
  animation: sunBurstAnim 3.5s ease-out forwards;
  pointer-events: none;
  /* 聖潔多層次銀白發光效果 */
  filter:
    drop-shadow(0 0 30px rgba(255, 255, 255, 1))
    drop-shadow(0 0 60px rgba(180, 230, 255, 0.85))
    drop-shadow(0 0 100px rgba(255, 200, 230, 0.6));
}

/* ===== 太陽能量槽與白金霓虹樣式 ===== */
.sun-energy-bar {
  color: #ffcc00 !important;
  border-color: rgba(255, 204, 0, 0.5) !important;
  text-shadow:
    0 0 10px #ffcc00,
    0 0 20px #ffaa00,
    0 0 40px rgba(255, 120, 0, 0.6) !important;
  box-shadow:
    0 0 12px rgba(255, 204, 0, 0.25),
    inset 0 0 15px rgba(255, 204, 0, 0.1) !important;
}

.sun-coin-count {
  font-size: 32px;
  font-weight: 900;
  color: #ffffff;
  text-shadow:
    0 0 10px #ffffff,
    0 0 20px #ffcc00,
    0 0 30px #ffaa00;
  display: inline-block;
  animation: sunCoinPulse 2s ease-in-out infinite;
}

@keyframes sunCoinPulse {
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.1);
    color: #ffeb3b;
  }
}

/* ===== 護盾剩餘時間 Overlay ===== */
.shield-status-overlay {
  position: absolute;
  top: 15px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(20, 15, 5, 0.85);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 215, 0, 0.5);
  padding: 8px 18px;
  border-radius: 9999px;
  color: #ffd700;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 1px;
  z-index: 8;
  box-shadow:
    0 4px 15px rgba(0, 0, 0, 0.5),
    0 0 12px rgba(255, 215, 0, 0.35);
  text-shadow: 0 0 6px rgba(255, 215, 0, 0.8);
  animation: shieldStatusPulse 1.5s ease-in-out infinite;
}

@keyframes shieldStatusPulse {
  0%, 100% {
    opacity: 0.9;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5), 0 0 8px rgba(255, 215, 0, 0.25);
  }
  50% {
    opacity: 1;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5), 0 0 18px rgba(255, 215, 0, 0.55);
  }
}

/* ===== ⛩️ 太陽神殿（技能商店）樣式 ===== */
.sun-temple {
  border-color: rgba(255, 204, 0, 0.25) !important;
  background: rgba(10, 8, 2, 0.75) !important;
  box-shadow: 
    0 0 15px rgba(0, 0, 0, 0.6),
    0 0 8px rgba(255, 204, 0, 0.05);
}

.sun-temple .info-title {
  color: #ffcc00 !important;
  text-shadow: 0 0 8px rgba(255, 204, 0, 0.6) !important;
  border-bottom-color: rgba(255, 204, 0, 0.2) !important;
}

.temple-shop {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 4px;
}

.shop-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  transition: all 0.3s ease;
}

/* 當能量足夠購買時的高亮樣式 */
.shop-item.affordable {
  background: rgba(255, 204, 0, 0.03);
  border-color: rgba(255, 204, 0, 0.15);
}

.shop-item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  max-width: 110px;
}

.shop-item-title {
  font-size: 11px;
  font-weight: 700;
  color: #ffffff;
}

.shop-item.affordable .shop-item-title {
  color: #ffeb3b;
  text-shadow: 0 0 4px rgba(255, 235, 59, 0.3);
}

.shop-item-desc {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.45);
  font-family: sans-serif;
  line-height: 1.2;
}

/* 技能商店購買按鈕 */
.shop-buy-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 58px;
  height: 38px;
  background: rgba(30, 30, 30, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  padding: 2px;
}

.shop-buy-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.shop-buy-btn .cost {
  font-size: 11px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.5);
  font-family: 'Orbitron', sans-serif;
}

.shop-buy-btn .shop-kbd {
  font-size: 8px;
  color: rgba(255, 255, 255, 0.3);
  font-family: 'Orbitron', sans-serif;
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 0 4px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.4);
  margin-top: 1px;
  transform: scale(0.9);
}

/* 當可購買時的發光按鈕樣式 */
.shop-item.affordable .shop-buy-btn {
  background: linear-gradient(180deg, rgba(80, 60, 20, 0.9), rgba(30, 20, 5, 0.9));
  border: 1px solid rgba(255, 204, 0, 0.45);
  border-bottom: 2px solid rgba(255, 170, 0, 0.6);
  box-shadow: 0 0 8px rgba(255, 170, 0, 0.15);
}

.shop-item.affordable .shop-buy-btn .cost {
  color: #ffeb3b;
  text-shadow: 0 0 6px rgba(255, 235, 59, 0.6);
}

.shop-item.affordable .shop-buy-btn .shop-kbd {
  color: #ffcc00;
  border-color: rgba(255, 204, 0, 0.3);
  background: rgba(0, 0, 0, 0.5);
}

/* 可購買按鈕懸停動畫 */
.shop-item.affordable .shop-buy-btn:hover:not(:disabled) {
  background: linear-gradient(180deg, rgba(120, 90, 30, 1), rgba(50, 30, 5, 1));
  border-color: #ffeb3b;
  box-shadow:
    0 0 15px rgba(255, 204, 0, 0.55),
    0 0 3px rgba(255, 255, 255, 0.2);
  transform: translateY(-2px) scale(1.04);
}

.shop-item.affordable .shop-buy-btn:active:not(:disabled) {
  transform: translateY(-0.5px) scale(1.01);
}

/* ===== 無敵狀態下蛇的白金金色流光與發光特效 ===== */
.shield-active-board .snake {
  background: linear-gradient(180deg, #ffffff 0%, #fff6d6 30%, #ffd966 60%, #cca010 100%) !important;
  box-shadow:
    0 0 16px rgba(255, 215, 0, 0.95),
    0 0 32px rgba(255, 240, 150, 0.6),
    inset 0 2px 4px rgba(255, 255, 255, 0.85),
    inset 0 -2px 4px rgba(200, 150, 10, 0.9) !important;
  animation: goldShieldFlow 1.2s ease-in-out infinite alternate !important;
}

.shield-active-board .snake-head {
  background: radial-gradient(ellipse at 30% 30%, #ffffff 0%, #ffe894 50%, #cca010 100%) !important;
  box-shadow:
    0 0 25px rgba(255, 215, 0, 1),
    0 0 50px rgba(255, 245, 170, 0.85),
    inset 0 2px 6px rgba(255, 255, 255, 0.9),
    inset 0 -2px 6px rgba(200, 150, 10, 0.95) !important;
  animation: goldShieldFlow 1.2s ease-in-out infinite alternate !important;
}

.shield-active-board .snake-head::before,
.shield-active-board .snake-head::after {
  box-shadow:
    0 0 12px rgba(255, 235, 59, 1),
    0 0 24px rgba(255, 193, 7, 0.9) !important;
}

@keyframes goldShieldFlow {
  0% {
    filter: brightness(1) drop-shadow(0 0 2px rgba(255, 215, 0, 0.5));
  }
  100% {
    filter: brightness(1.2) drop-shadow(0 0 8px rgba(255, 255, 255, 0.9));
  }
}

/* ===== 玩家 ID 輸入彈窗樣式 ===== */
.id-input-overlay {
  background: rgba(5, 7, 15, 0.95) !important;
  backdrop-filter: blur(20px) !important;
  -webkit-backdrop-filter: blur(20px) !important;
}

.id-content {
  gap: 16px !important;
}

.id-input-wrapper {
  position: relative;
  width: min(85vw, 280px);
  margin: 10px 0 15px 0;
}

.id-input-field {
  width: 100%;
  padding: 12px 16px;
  background: rgba(10, 16, 32, 0.7);
  border: 1px solid rgba(0, 255, 255, 0.25);
  border-radius: 8px;
  color: #ffffff;
  font-family: 'Orbitron', sans-serif;
  font-size: 16px;
  font-weight: 700;
  text-align: center;
  outline: none;
  letter-spacing: 1px;
  box-shadow:
    0 10px 25px rgba(0, 0, 0, 0.5),
    inset 0 0 10px rgba(0, 255, 255, 0.03);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.id-input-field:focus {
  border-color: #00ffff;
  box-shadow:
    0 0 20px rgba(0, 255, 255, 0.4),
    0 0 40px rgba(0, 255, 255, 0.1),
    inset 0 0 10px rgba(0, 255, 255, 0.1);
}

.id-input-field::placeholder {
  color: rgba(255, 255, 255, 0.25);
  font-weight: normal;
  font-size: 14px;
}

/* 未來科技感的四角定位折角裝飾 */
.tech-corner {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 2px solid rgba(0, 255, 255, 0.4);
  pointer-events: none;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.tech-corner.top-left {
  top: -2px;
  left: -2px;
  border-right: none;
  border-bottom: none;
}

.tech-corner.top-right {
  top: -2px;
  right: -2px;
  border-left: none;
  border-bottom: none;
}

.tech-corner.bottom-left {
  bottom: -2px;
  left: -2px;
  border-right: none;
  border-top: none;
}

.tech-corner.bottom-right {
  bottom: -2px;
  right: -2px;
  border-left: none;
  border-top: none;
}

.id-input-field:focus ~ .tech-corner {
  border-color: #00ffff;
  filter: drop-shadow(0 0 5px #00ffff);
}

.id-input-field:focus ~ .tech-corner.top-left { transform: translate(-2px, -2px); }
.id-input-field:focus ~ .tech-corner.top-right { transform: translate(2px, -2px); }
.id-input-field:focus ~ .tech-corner.bottom-left { transform: translate(-2px, 2px); }
.id-input-field:focus ~ .tech-corner.bottom-right { transform: translate(2px, 2px); }

.submit-id-btn {
  color: #c084fc !important;
  border-color: rgba(168, 85, 247, 0.4) !important;
  box-shadow:
    0 0 15px rgba(168, 85, 247, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
}

.submit-id-btn:hover {
  border-color: #c084fc !important;
  color: #ffffff !important;
  box-shadow:
    0 0 25px rgba(168, 85, 247, 0.65),
    0 0 50px rgba(168, 85, 247, 0.2) !important;
}

/* ===== 🏆 高分排行榜卡片與表格樣式 ===== */
.leaderboard-block {
  margin-top: 6px; /* 與上方技能神殿緊湊對齊 */
}

.leaderboard-block .score-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
  font-size: 11px;
}

.leaderboard-block .score-table th {
  color: rgba(255, 255, 255, 0.35);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 6px 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.th-rank { width: 22%; text-align: center !important; }
.th-player { width: 50%; text-align: left !important; }
.th-score { width: 28%; text-align: right !important; }

.leaderboard-block .score-table tr {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: background-color 0.2s ease;
}

.leaderboard-block .score-table tr:last-child {
  border-bottom: none;
}

.leaderboard-block .score-table tr:hover {
  background-color: rgba(255, 255, 255, 0.02);
}

.leaderboard-block .score-table td {
  padding: 6px 4px;
  vertical-align: middle;
}

.rank-num {
  text-align: center;
}

.rank-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  font-weight: 900;
  font-family: 'Orbitron', sans-serif;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.4);
  font-size: 9px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.player-name {
  color: rgba(255, 255, 255, 0.75);
  font-weight: 700;
  font-family: sans-serif;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 90px;
  text-align: left;
}

.leaderboard-block .score-val {
  text-align: right;
  color: #00ffff;
  font-weight: 700;
  font-family: 'Orbitron', sans-serif;
  font-size: 11px;
  text-shadow: 0 0 6px rgba(0, 255, 255, 0.3);
}

.no-records {
  text-align: center;
  padding: 20px 0 !important;
}

.no-records-text {
  color: rgba(255, 255, 255, 0.3);
  font-family: sans-serif;
  font-size: 11px;
  letter-spacing: 1px;
}

/* --- 尊貴名次金銀銅三色霓虹發光樣式 --- */
/* 第 1 名：金黃色 (Gold Glory) */
.rank-1 .rank-badge {
  background: rgba(255, 204, 0, 0.12) !important;
  color: #ffcc00 !important;
  border: 1px solid rgba(255, 204, 0, 0.4);
  box-shadow: 0 0 6px rgba(255, 204, 0, 0.25);
}
.rank-1 .player-name {
  color: #ffd700 !important;
  text-shadow: 0 0 4px rgba(255, 215, 0, 0.3);
}
.rank-1 .score-val {
  color: #ffd700 !important;
  text-shadow: 0 0 8px rgba(255, 215, 0, 0.6) !important;
}

/* 第 2 名：銀白色 (Silver Glory) */
.rank-2 .rank-badge {
  background: rgba(243, 244, 246, 0.08) !important;
  color: #e5e7eb !important;
  border: 1px solid rgba(243, 244, 246, 0.3);
  box-shadow: 0 0 6px rgba(243, 244, 246, 0.2);
}
.rank-2 .player-name {
  color: #f3f4f6 !important;
}
.rank-2 .score-val {
  color: #f3f4f6 !important;
  text-shadow: 0 0 8px rgba(255, 255, 255, 0.5) !important;
}

/* 第 3 名：青銅橘色 (Bronze Glory) */
.rank-3 .rank-badge {
  background: rgba(217, 119, 6, 0.12) !important;
  color: #f59e0b !important;
  border: 1px solid rgba(217, 119, 6, 0.3);
  box-shadow: 0 0 6px rgba(217, 119, 6, 0.2);
}
.rank-3 .player-name {
  color: #fbbf24 !important;
}
.rank-3 .score-val {
  color: #fbbf24 !important;
  text-shadow: 0 0 8px rgba(251, 191, 36, 0.5) !important;
}

/* ===== ⚔️ Boss 戰模式切換按鈕 ===== */
.boss-mode-btn {
  border-color: rgba(255, 80, 0, 0.4) !important;
  color: rgba(255, 255, 255, 0.8) !important;
  box-shadow: 0 0 10px rgba(255, 80, 0, 0.1) !important;
  margin-right: 4px;
}

.boss-mode-btn:hover {
  color: #ff6633 !important;
  border-color: rgba(255, 102, 51, 0.7) !important;
  box-shadow: 0 0 15px rgba(255, 102, 51, 0.4), 0 0 30px rgba(255, 80, 0, 0.15) !important;
  text-shadow: 0 0 8px rgba(255, 102, 51, 0.6) !important;
}

/* ===== 🏆 頂部黃金高分榜按鈕與 GameOver 雙按鈕樣式 ===== */
.leaderboard-btn {
  border-color: rgba(255, 204, 0, 0.4) !important;
  color: rgba(255, 255, 255, 0.8) !important;
  box-shadow: 0 0 10px rgba(255, 204, 0, 0.05) !important;
  margin-right: 8px; /* 拉開與設定按鈕間距 */
}

.leaderboard-btn:hover {
  color: #ffcc00 !important;
  border-color: rgba(255, 204, 0, 0.7) !important;
  box-shadow:
    0 0 15px rgba(255, 204, 0, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  transform: translateY(-1px);
}

.leaderboard-btn.active {
  color: #ffcc00 !important;
  border-color: rgba(255, 204, 0, 0.9) !important;
  background: rgba(45, 35, 10, 0.85) !important;
  box-shadow:
    0 0 12px rgba(255, 204, 0, 0.5),
    0 0 25px rgba(255, 204, 0, 0.2) !important;
  text-shadow: 0 0 8px rgba(255, 204, 0, 0.6) !important;
}

/* GameOver 雙按鈕排版 */
.gameover-actions {
  display: flex;
  gap: 12px;
  margin-top: 12px;
  justify-content: center;
}

.gameover-btn {
  background: linear-gradient(135deg, #9333ea, #7c3aed) !important;
  color: white;
  border: none;
  padding: 10px 20px !important;
  font-size: 15px !important;
  border-radius: 6px;
  cursor: pointer;
  font-family: 'Orbitron', sans-serif;
  box-shadow: 0 0 15px rgba(147, 51, 234, 0.4) !important;
  transition: all 0.25s ease !important;
}

.gameover-btn:hover {
  box-shadow: 0 0 25px rgba(147, 51, 234, 0.7) !important;
  transform: scale(1.04);
}

.gameover-btn.secondary-btn {
  background: linear-gradient(180deg, rgba(30, 25, 15, 0.85), rgba(15, 12, 8, 0.95)) !important;
  border: 1px solid rgba(255, 204, 0, 0.45) !important;
  border-bottom: 2px solid rgba(255, 170, 0, 0.6) !important;
  color: #ffeb3b !important;
  box-shadow: 0 0 8px rgba(255, 170, 0, 0.15) !important;
}

.gameover-btn.secondary-btn:hover {
  background: linear-gradient(180deg, rgba(50, 40, 20, 1), rgba(25, 20, 10, 1)) !important;
  border-color: #ffeb3b !important;
  box-shadow:
    0 0 20px rgba(255, 204, 0, 0.4),
    0 0 5px rgba(255, 255, 255, 0.1) !important;
}

/* ===== 🏛️ 全螢幕高透光黃金高分榜彈窗樣式 ===== */
.leaderboard-overlay {
  background: rgba(3, 4, 10, 0.93) !important;
  backdrop-filter: blur(20px) !important;
  -webkit-backdrop-filter: blur(20px) !important;
}

.leaderboard-dialog {
  width: min(90vw, 420px) !important; /* 排行榜視窗稍微加寬以容納日期 */
  background: rgba(10, 12, 24, 0.75) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-top: 2px solid rgba(255, 204, 0, 0.45) !important;
  border-radius: 16px !important;
  padding: 35px 25px !important;
  box-shadow:
    0 25px 60px rgba(0, 0, 0, 0.9),
    0 0 35px rgba(255, 204, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
}

.rank-crown {
  font-size: 64px !important;
  filter: drop-shadow(0 0 15px rgba(255, 204, 0, 0.5)) !important;
  margin-bottom: -5px;
}

/* 彈窗表格樣式 */
.popup-table {
  width: 100% !important;
  border-collapse: collapse !important;
  margin: 15px 0 25px 0 !important;
  font-size: 13px !important;
}

.popup-table th {
  color: rgba(255, 255, 255, 0.35) !important;
  font-size: 11px !important;
  padding: 8px 6px !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
}

.popup-table .th-rank { width: 18% !important; text-align: center !important; }
.popup-table .th-player { width: 44% !important; text-align: left !important; }
.popup-table .th-score { width: 20% !important; text-align: right !important; }
.popup-table .th-date { width: 18% !important; text-align: right !important; }

.popup-table tr {
  border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
}

.popup-table tr:hover {
  background-color: rgba(255, 255, 255, 0.03) !important;
}

.popup-table td {
  padding: 10px 6px !important; /* 加高內距更為舒適 */
}

.popup-table .rank-badge {
  width: 22px !important;
  height: 22px !important;
  font-size: 10px !important;
}

.popup-table .player-name {
  font-size: 13px !important;
  max-width: 140px !important;
}

.popup-table .score-val {
  font-size: 13px !important;
  text-shadow: 0 0 8px rgba(0, 255, 255, 0.4) !important;
}

.score-date {
  text-align: right;
  color: rgba(255, 255, 255, 0.45);
  font-family: 'Orbitron', sans-serif;
  font-size: 11px;
}

.close-leaderboard-btn {
  color: #ffcc00 !important;
  border-color: rgba(255, 204, 0, 0.4) !important;
  box-shadow:
    0 0 15px rgba(255, 204, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  font-size: 16px !important;
  padding: 12px 36px !important;
}

.close-leaderboard-btn:hover {
  border-color: #ffcc00 !important;
  color: #ffffff !important;
  box-shadow:
    0 0 25px rgba(255, 204, 0, 0.65),
    0 0 50px rgba(255, 204, 0, 0.2) !important;
}
</style>
