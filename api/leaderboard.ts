import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

// 定義高分榜資料結構
interface ClassicRecord {
  name: string;
  score: number;
  date: string;
}

interface BossRecord {
  name: string;
  time: number; // 通關秒數
  date: string;
}

// ==========================================
// 🚀 本地開發記憶體降備儲存（在無 Redis 環境下運作）
// ==========================================
let localClassicLeaderboard: ClassicRecord[] = [];

let localBossLeaderboard: BossRecord[] = [];

// 檢查是否處於 Vercel 生產環境（即已連結 Vercel KV）
const isKvConfigured = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 設置 CORS 頭部以允許前端流暢請求
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // 處理 Preflight 的 OPTIONS 請求
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // ==========================================
    // 1. 處理 GET 請求：撈取世界排行榜
    // ==========================================
    if (req.method === 'GET') {
      let classicList: ClassicRecord[] = [];
      let bossList: BossRecord[] = [];

      if (isKvConfigured) {
        // 從 Vercel Redis 資料庫撈取
        const savedClassic = await kv.get<ClassicRecord[]>('snake_global_classic_board');
        const savedBoss = await kv.get<BossRecord[]>('snake_global_boss_board');
        classicList = savedClassic || [];
        bossList = savedBoss || [];
      } else {
        // 本地降備模擬數據
        classicList = localClassicLeaderboard;
        bossList = localBossLeaderboard;
      }

      return res.status(200).json({
        success: true,
        classic: classicList,
        boss: bossList,
        mode: isKvConfigured ? 'production_redis' : 'local_mock'
      });
    }

    // ==========================================
    // 2. 處理 POST 請求：上傳新紀錄
    // ==========================================
    if (req.method === 'POST') {
      const { name, score, time, mode, date } = req.body;
      const cleanName = (name || '無名戰神').trim().substring(0, 12); // ID 長度限制 12

      if (mode === 'classic') {
        // 經典高分榜處理邏輯
        const newScore = Math.max(0, parseInt(score, 10) || 0);
        let board: ClassicRecord[] = [];

        if (isKvConfigured) {
          board = (await kv.get<ClassicRecord[]>('snake_global_classic_board')) || [];
        } else {
          board = [...localClassicLeaderboard];
        }

        // 新增本次佳績
        board.push({ name: cleanName, score: newScore, date });

        // 降序排序（高分在前面）
        board.sort((a, b) => b.score - a.score);

        // 精確保留前 5 名
        const trimmedBoard = board.slice(0, 5);

        if (isKvConfigured) {
          await kv.set('snake_global_classic_board', trimmedBoard);
        } else {
          localClassicLeaderboard = trimmedBoard;
        }

        return res.status(200).json({ success: true, leaderboard: trimmedBoard });
      } 
      
      else if (mode === 'boss') {
        // Boss 速度榜處理邏輯
        const newTime = Math.max(1, parseInt(time, 10) || 0);
        let board: BossRecord[] = [];

        if (isKvConfigured) {
          board = (await kv.get<BossRecord[]>('snake_global_boss_board')) || [];
        } else {
          board = [...localBossLeaderboard];
        }

        // 同一個 ID 直接覆蓋為該玩家的個人最佳紀錄（取通關時間最短者）
        const existingIndex = board.findIndex(r => r.name === cleanName);
        if (existingIndex !== -1) {
          if (newTime < board[existingIndex]!.time) {
            board[existingIndex]!.time = newTime;
            board[existingIndex]!.date = date;
          }
        } else {
          board.push({ name: cleanName, time: newTime, date });
        }

        // 再做一次嚴格的主動去重防禦
        const uniqueRecords: BossRecord[] = [];
        for (const r of board) {
          const idx = uniqueRecords.findIndex(u => u.name === r.name);
          if (idx !== -1) {
            if (r.time < uniqueRecords[idx]!.time) {
              uniqueRecords[idx] = r;
            }
          } else {
            uniqueRecords.push(r);
          }
        }

        // 升序排序（通關用時越短排名越前）
        uniqueRecords.sort((a, b) => a.time - b.time);

        // 精確保留前 5 名
        const trimmedBoard = uniqueRecords.slice(0, 5);

        if (isKvConfigured) {
          await kv.set('snake_global_boss_board', trimmedBoard);
        } else {
          localBossLeaderboard = trimmedBoard;
        }

        return res.status(200).json({ success: true, leaderboard: trimmedBoard });
      }

      return res.status(400).json({ success: false, message: '不支援的遊戲模式' });
    }

    return res.status(405).json({ success: false, message: '不支援的 HTTP 方法' });
  } catch (error: any) {
    console.error('API 處理發生異常:', error);
    return res.status(500).json({ success: false, message: '伺服器內部發生異常', error: error.message });
  }
}
