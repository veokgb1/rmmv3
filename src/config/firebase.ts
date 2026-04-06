// Firebase 初始化引擎 — S5 云端接入
// 从 .env.local 读取环境变量，导出 db / storage 单例
// 所有 Firebase 服务通过此文件统一获取，禁止在其他文件直接 initializeApp

import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getFirestore,  type Firestore    } from 'firebase/firestore'
import { getStorage,   type FirebaseStorage } from 'firebase/storage'
import { getAuth,      type Auth           } from 'firebase/auth'

// ── 必填环境变量清单 ───────────────────────────────────────────
const REQUIRED_VARS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const

// ── 连接前检测：所有变量必须存在且非空 ────────────────────────
function validateEnv(): void {
  const missing = REQUIRED_VARS.filter(
    key => !import.meta.env[key] || String(import.meta.env[key]).trim() === ''
  )

  if (missing.length > 0) {
    // 缺少变量时：抛出明确错误，避免 SDK 以神秘方式崩溃
    throw new Error(
      `[Firebase] 🚨 缺少必要环境变量:\n${missing.map(k => `  · ${k}`).join('\n')}\n` +
      `请检查根目录 .env.local 文件，修改后重启 npm run dev`
    )
  }
  console.info(
    `%c[Firebase] ✅ 连接配置就绪`,
    'color: #10b981; font-weight: bold',
    `→ 项目: ${import.meta.env.VITE_FIREBASE_PROJECT_ID}`,
  )
}

// ── Firebase 应用初始化（模块加载时立即执行） ─────────────────
validateEnv()

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY         as string,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        as string,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         as string,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID             as string,
}

const app: FirebaseApp    = initializeApp(firebaseConfig)
export const db: Firestore          = getFirestore(app)
export const storage: FirebaseStorage = getStorage(app)
export const auth: Auth             = getAuth(app)

// ── 开发环境辅助日志 ──────────────────────────────────────────
// 仅在 import.meta.env.DEV 时打印，生产包自动 tree-shake
if (import.meta.env.DEV) {
  console.debug('[Firebase] SDK 单例已初始化', {
    projectId: firebaseConfig.projectId,
    authDomain: firebaseConfig.authDomain,
  })
}
