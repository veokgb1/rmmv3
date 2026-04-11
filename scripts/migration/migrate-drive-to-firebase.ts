/**
 * migrate-drive-to-firebase.ts
 * ════════════════════════════════════════════════════════════════
 * V2 → V3 物理迁移脚本：Google Drive 凭证图片 → Firebase Storage
 *
 * 执行流程：
 *   1. 读取 export.json（V2 导出数据）
 *   2. 遍历每条 transaction 的 voucherIds
 *   3. 从 Google Drive 下载文件（Node.js 环境，无 CORS 限制）
 *   4. 上传到 Firebase Storage（receipts/{ledgerId}/{legacyRowNum}/...）
 *   5. 写出 v3-migrated.json（含 v3VoucherObjects 字段供前端使用）
 *
 * 运行方式：
 *   npx tsx scripts/migration/migrate-drive-to-firebase.ts
 *
 * 断点续传：
 *   脚本维护 v3-migrated.json，已成功上传的条目不重复处理
 *   强制重跑：删除 v3-migrated.json 后重新执行
 * ════════════════════════════════════════════════════════════════
 */

import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app'
import { getStorage } from 'firebase-admin/storage'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

// ── 路径常量（已自动注入） ──────────────────────────────────────
const __filename = fileURLToPath(import.meta.url)
const __dirname  = fileURLToPath(new URL('.', import.meta.url))

const SERVICE_ACCOUNT_PATH = 'E:/rmm-2sys/rmm-workspace/2.V2rmm/migrate/serviceAccount.json'
const EXPORT_JSON_PATH      = 'E:/rmm-2sys/rmm-workspace/2.V2rmm/migrate/export.json'
const OUTPUT_JSON_PATH      = join(__dirname, 'v3-migrated.json')

const TARGET_LEDGER_ID  = '0WZxzZnVfvrml2MEmNSr'
const STORAGE_BUCKET    = 'rmm-v3-2603.firebasestorage.app'

// ── 类型定义 ──────────────────────────────────────────────────
interface V2Transaction {
  _legacyRowNum: number
  date:          string
  month?:        string
  type:          string
  category:      string
  amount:        number
  summary:       string
  source?:       string
  status?:       string
  voucherIds:    string[]
}

interface ExportJson {
  checksum:     { totalRows: number; totalVoucherFiles: number }
  transactions: V2Transaction[]
}

interface V3VoucherObject {
  legacyDriveId: string
  legacyRowNum:  number
  storageUrl:    string
  storagePath:   string
  fileName:      string
}

interface MigratedTransaction {
  _legacyRowNum:    number
  v3VoucherObjects: V3VoucherObject[]
}

interface OutputJson {
  generatedAt:  string
  ledgerId:     string
  transactions: MigratedTransaction[]
}

// ── Firebase Admin 初始化 ──────────────────────────────────────
console.log('⚙️  初始化 Firebase Admin SDK...')
const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8')) as ServiceAccount
initializeApp({
  credential:    cert(serviceAccount),
  storageBucket: STORAGE_BUCKET,
})
const bucket = getStorage().bucket()
console.log(`✅ 已连接 Storage Bucket: ${STORAGE_BUCKET}`)

// ── 工具函数 ──────────────────────────────────────────────────

/**
 * 从 Google Drive 下载公开分享文件的原始字节
 * 使用 drive.usercontent.google.com 端点，Node.js 环境无 CORS 限制
 */
async function downloadFromDrive(driveId: string): Promise<{ buffer: Buffer; contentType: string }> {
  const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; RMM-Migrator/1.0)' }
  const url = `https://drive.usercontent.google.com/download?id=${driveId}&export=download&confirm=t`

  let resp = await fetch(url, { redirect: 'follow', headers: HEADERS })

  if (!resp.ok) {
    throw new Error(`Drive 下载失败 id=${driveId} status=${resp.status}`)
  }

  // Google Drive 对大文件有时返回 HTML 病毒警告确认页
  // 必须 clone() 再读 text，保留原始 body 供后续 arrayBuffer() 使用
  const ct = resp.headers.get('content-type') ?? 'application/octet-stream'
  if (ct.startsWith('text/html')) {
    const html = await resp.clone().text()
    const match = html.match(/name="confirm"\s+value="([^"]+)"/)
    if (match) {
      const confirmUrl = `https://drive.usercontent.google.com/download?id=${driveId}&export=download&confirm=${match[1]}`
      resp = await fetch(confirmUrl, { redirect: 'follow', headers: HEADERS })
      if (!resp.ok) {
        throw new Error(`Drive 确认下载失败 id=${driveId} status=${resp.status}`)
      }
    } else {
      // 无法解析确认表单，直接尝试读取（可能是小文件直接返回 HTML，罕见）
      const fallback = await resp.arrayBuffer()
      if (fallback.byteLength === 0) throw new Error(`Drive 返回空 HTML id=${driveId}`)
      return { buffer: Buffer.from(fallback), contentType: ct }
    }
  }

  const finalCt = resp.headers.get('content-type') ?? 'application/octet-stream'
  const arrayBuffer = await resp.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  if (buffer.length === 0) {
    throw new Error(`Drive 返回空文件 id=${driveId}`)
  }

  return { buffer, contentType: finalCt }
}

/**
 * 根据 MIME type 推断文件扩展名
 */
function mimeToExt(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg':               'jpg',
    'image/jpg':                'jpg',
    'image/png':                'png',
    'image/gif':                'gif',
    'image/webp':               'webp',
    'image/heic':               'heic',
    'image/heif':               'heif',
    'application/pdf':          'pdf',
    'application/octet-stream': 'bin',
  }
  const base = contentType.split(';')[0].trim().toLowerCase()
  return map[base] ?? 'bin'
}

/**
 * 上传 Buffer 到 Firebase Storage，返回含 Token 的前端可用下载 URL
 *
 * 关键修复：注入 firebaseStorageDownloadTokens 元数据
 * ─────────────────────────────────────────────────────────────
 * Admin SDK 上传的文件默认不含下载令牌，前端 Client SDK 的 getDownloadURL()
 * 在找不到 firebaseStorageDownloadTokens 时会抛出 404（Object Not Found）。
 * 解决方案：上传时在 metadata.metadata 中注入 UUID token，
 * 并将其拼接到返回 URL 末尾，使前端和 <img src> 都可直接使用该链接。
 */
async function uploadToStorage(
  buffer:      Buffer,
  storagePath: string,
  contentType: string,
): Promise<string> {
  const file  = bucket.file(storagePath)
  const token = randomUUID()   // 生成下载令牌

  await file.save(buffer, {
    metadata: {
      contentType,
      cacheControl: 'public, max-age=31536000',
      metadata: {
        firebaseStorageDownloadTokens: token,  // ← 关键：注入前端通行证
      },
    },
  })

  // 构造含 token 的完整下载 URL（前端 getDownloadURL 返回相同格式）
  const encodedPath = encodeURIComponent(storagePath)
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodedPath}?alt=media&token=${token}`
}

// ── 加载/保存断点续传状态 ──────────────────────────────────────

function loadOutput(): OutputJson {
  if (existsSync(OUTPUT_JSON_PATH)) {
    try {
      const existing = JSON.parse(readFileSync(OUTPUT_JSON_PATH, 'utf-8')) as OutputJson
      console.log(`📂 发现断点续传文件，已处理 ${existing.transactions.length} 条记录`)
      return existing
    } catch {
      console.warn('⚠️  断点续传文件解析失败，重新开始')
    }
  }
  return {
    generatedAt:  new Date().toISOString(),
    ledgerId:     TARGET_LEDGER_ID,
    transactions: [],
  }
}

function saveOutput(output: OutputJson): void {
  output.generatedAt = new Date().toISOString()
  writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(output, null, 2), 'utf-8')
}

// ── 主流程 ────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 读取 V2 导出数据
  console.log(`📖 读取 export.json: ${EXPORT_JSON_PATH}`)
  const exportData = JSON.parse(readFileSync(EXPORT_JSON_PATH, 'utf-8')) as ExportJson
  const { transactions } = exportData
  console.log(`   共 ${transactions.length} 条交易，${exportData.checksum.totalVoucherFiles} 个凭证文件`)

  // 加载断点续传状态
  const output = loadOutput()
  const doneRowNums = new Set(output.transactions.map(t => t._legacyRowNum))

  // 统计
  let successCount = 0
  let skipCount    = 0
  let errorCount   = 0
  const errors: Array<{ legacyRowNum: number; driveId: string; error: string }> = []

  for (const tx of transactions) {
    const rowNum = tx._legacyRowNum

    // 跳过已处理
    if (doneRowNums.has(rowNum)) {
      console.log(`  ⏭️  跳过 Row#${rowNum}（已处理）`)
      skipCount++
      continue
    }

    if (!tx.voucherIds || tx.voucherIds.length === 0) {
      // 无凭证，写入空 voucherObjects
      output.transactions.push({ _legacyRowNum: rowNum, v3VoucherObjects: [] })
      saveOutput(output)
      console.log(`  📭 Row#${rowNum} 无凭证，跳过`)
      skipCount++
      continue
    }

    console.log(`\n📦 处理 Row#${rowNum}（${tx.date} ${tx.category} ¥${tx.amount}）`)
    console.log(`   凭证数量：${tx.voucherIds.length}`)

    const v3VoucherObjects: V3VoucherObject[] = []

    for (const driveId of tx.voucherIds) {
      const cleanId = driveId.trim()
      if (!cleanId) continue

      try {
        process.stdout.write(`   ⬇️  下载 ${cleanId} ... `)

        const { buffer, contentType } = await downloadFromDrive(cleanId)
        const ext        = mimeToExt(contentType)
        const fileName   = `${Date.now()}_${cleanId}.${ext}`
        const storagePath = `receipts/${TARGET_LEDGER_ID}/${rowNum}/${fileName}`

        process.stdout.write(`${(buffer.length / 1024).toFixed(1)} KB | ⬆️  上传 ... `)

        const storageUrl = await uploadToStorage(buffer, storagePath, contentType)

        console.log(`✅`)
        v3VoucherObjects.push({
          legacyDriveId: cleanId,
          legacyRowNum:  rowNum,
          storageUrl,
          storagePath,
          fileName,
        })
        successCount++

        // 限速：每次上传后等待 300ms，避免触发 Google Drive 限流
        await new Promise(resolve => setTimeout(resolve, 300))

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.log(`❌ ${msg}`)
        errors.push({ legacyRowNum: rowNum, driveId: cleanId, error: msg })
        errorCount++
      }
    }

    // 写入当前 row 结果（即使部分失败，也保存已成功的）
    output.transactions.push({ _legacyRowNum: rowNum, v3VoucherObjects })
    saveOutput(output)
  }

  // ── 最终报告 ──────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60))
  console.log('📊 迁移完成报告')
  console.log('═'.repeat(60))
  console.log(`  ✅ 成功上传凭证：${successCount} 个`)
  console.log(`  ⏭️  跳过（断点/无凭证）：${skipCount} 条`)
  console.log(`  ❌ 失败：${errorCount} 个`)
  console.log(`  📄 输出文件：${OUTPUT_JSON_PATH}`)

  if (errors.length > 0) {
    console.log('\n失败明细：')
    for (const e of errors) {
      console.log(`  Row#${e.legacyRowNum} driveId=${e.driveId}: ${e.error}`)
    }
    console.log('\n⚠️  有失败条目，可重新运行脚本继续（断点续传会跳过已成功的）')
    process.exit(1)
  } else {
    console.log('\n🎉 全部凭证迁移成功！前端可使用 v3-migrated.json 写入 Firestore')
    process.exit(0)
  }
}

main().catch(err => {
  console.error('💥 脚本异常终止:', err)
  process.exit(1)
})
