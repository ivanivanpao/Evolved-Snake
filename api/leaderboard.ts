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
      let usedRedis = false;

      try {
        // 直接嘗試從 Vercel Redis 資料庫撈取
        const savedClassic = await kv.get<ClassicRecord[]>('snake_global_classic_board');
        const savedBoss = await kv.get<BossRecord[]>('snake_global_boss_board');
        classicList = savedClassic || [];
        bossList = savedBoss || [];
        usedRedis = true;
      } catch (redisError) {
        console.warn('無法連線至 Vercel KV Redis，啟用本地記憶體降備:', redisError);
        // 連不上時（如本地開發），自動降級採用本地記憶體暫存
        classicList = localClassicLeaderboard;
        bossList = localBossLeaderboard;
      }

      return res.status(200).json({
        success: true,
        classic: classicList,
        boss: bossList,
        mode: usedRedis ? 'production_redis' : 'local_mock'
      });
    }

    // ==========================================
    // 2. 處理 POST 請求：上傳新紀錄
    // ==========================================
    if (req.method === 'POST') {
      const { name, score, time, mode, date } = req.body;
      const cleanName = (name || '無名戰神').trim().substring(0, 12); // ID 長度限制 12

      if (mode === 'classic') {
        const newScore = Math.max(0, parseInt(score, 10) || 0);
        let board: ClassicRecord[] = [];
        let usedRedis = false;

        try {
          // 嘗試從 Redis 讀取
          board = (await kv.get<ClassicRecord[]>('snake_global_classic_board')) || [];
          usedRedis = true;
        } catch (e) {
          board = [...localClassicLeaderboard];
        }

        // 新增本次佳績
        board.push({ name: cleanName, score: newScore, date });

        // 降序排序（高分在前面）
        board.sort((a, b) => b.score - a.score);

        // 精確保留前 5 名
        const trimmedBoard = board.slice(0, 5);

        if (usedRedis) {
          try {
            await kv.set('snake_global_classic_board', trimmedBoard);
          } catch (writeError) {
            console.error('寫入 Redis 失敗，改存本地記憶體:', writeError);
            localClassicLeaderboard = trimmedBoard;
          }
        } else {
          localClassicLeaderboard = trimmedBoard;
        }

        return res.status(200).json({ success: true, leaderboard: trimmedBoard });
      } 
      
      else if (mode === 'boss') {
        const newTime = Math.max(1, parseInt(time, 10) || 0);
        let board: BossRecord[] = [];
        let usedRedis = false;

        try {
          board = (await kv.get<BossRecord[]>('snake_global_boss_board')) || [];
          usedRedis = true;
        } catch (e) {
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

        if (usedRedis) {
          try {
            await kv.set('snake_global_boss_board', trimmedBoard);
          } catch (writeError) {
            console.error('寫入 Redis 失敗，改存本地記憶體:', writeError);
            localBossLeaderboard = trimmedBoard;
          }
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
