// EvidenceUploaderModal — 全局凭证拖拽上传模态框 (S21)
//
// 挂载位置：App.tsx > MainApp（全局单例，与 EjectionBlocker 同级）
// 显示条件：governanceStore.evidenceUploadTargetId !== null
//
// 核心功能：
//   · 原生 dragover / drop 事件实现拖拽上传（零第三方库）
//   · 点击区域触发系统文件选择器（input[type=file] hidden）
//   · 支持同时选择多文件，独立进度条并行上传
//   · 文件加入队列后立即开始上传（无需手动点击"开始"）
//   · 文件类型/大小前置校验（validateFile），不合格文件拒绝入队
//   · 全部文件处理完毕后"完成"按钮变为可点击状态
//   · 上传中关闭：若有任务进行中，拦截并提示用户
//
// 数据来源（全部从 Store 读取，无 Props）：
//   · evidenceUploadTargetId → txId（目标账单）
//   · activeLedgerId         → 构建 Storage 路径分区
//   · user.uid               → 写入 uploadedBy 字段

import { useState, useRef, useCallback, useEffect } from 'react'
import { useGovernanceStore }   from '@/store/governanceStore'
import { useLedgerStore }       from '@/store/ledgerStore'
import { useAuthStore }         from '@/store/authStore'
import {
  uploadEvidence,
  validateFile,
}                               from '@/services/firebase/evidenceService'
import type { Evidence }        from '@/types/Evidence.types'

// ════════════════════════════════════════════════════════════════
// § 1  单文件上传任务状态
// ════════════════════════════════════════════════════════════════

type FileStatus = 'pending' | 'uploading' | 'done' | 'error'

interface FileItem {
  /** 本地唯一键（用于 React key + 状态更新定位）*/
  key:       string
  file:      File
  status:    FileStatus
  progress:  number       // 0-100
  errorMsg?: string
  result?:   Evidence     // 上传成功后写入
}

// ════════════════════════════════════════════════════════════════
// § 2  主组件
// ════════════════════════════════════════════════════════════════

export default function EvidenceUploaderModal() {
  // ── Store 读取 ─────────────────────────────────────────────────
  const txId                 = useGovernanceStore(s => s.evidenceUploadTargetId)
  const closeEvidenceUploader = useGovernanceStore(s => s.closeEvidenceUploader)
  const activeLedgerId       = useLedgerStore(s => s.activeLedgerId)
  const user                 = useAuthStore(s => s.user)

  // ── 本地状态 ───────────────────────────────────────────────────
  const [fileItems,   setFileItems]   = useState<FileItem[]>([])
  const [isDragging,  setIsDragging]  = useState(false)
  const [rejectMsgs,  setRejectMsgs]  = useState<string[]>([])

  // 隐藏的 file input 引用（点击触发系统文件对话框）
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Modal 打开时重置所有状态 ────────────────────────────────────
  useEffect(() => {
    if (txId !== null) {
      setFileItems([])
      setIsDragging(false)
      setRejectMsgs([])
    }
  }, [txId])

  // ── 统计辅助 ────────────────────────────────────────────────────
  const hasUploading = fileItems.some(i => i.status === 'uploading' || i.status === 'pending')
  const allDone      = fileItems.length > 0 && !hasUploading
  const doneCount    = fileItems.filter(i => i.status === 'done').length
  const errorCount   = fileItems.filter(i => i.status === 'error').length

  // ── Modal 不可见时提前 return（不渲染任何 DOM）─────────────────
  if (txId === null) return null

  // ── 关闭处理（上传中拦截）──────────────────────────────────────
  function handleClose(): void {
    if (hasUploading) {
      const confirmed = window.confirm('仍有文件正在上传，确认关闭？\n关闭后上传可能中断。')
      if (!confirmed) return
    }
    closeEvidenceUploader()
  }

  // ── 背景蒙层点击关闭（同样检测上传状态）──────────────────────
  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.target === e.currentTarget) handleClose()
  }

  // ════════════════════════════════════════════════════════════════
  // § 3  文件处理核心逻辑
  // ════════════════════════════════════════════════════════════════

  /**
   * patchItem — 函数式更新单个 FileItem（通过 key 精确定位）
   * 使用 useCallback 稳定引用，避免 startUpload 闭包捕获旧 setFileItems
   */
  const patchItem = useCallback(
    (key: string, patch: Partial<FileItem>) => {
      setFileItems(prev =>
        prev.map(item => item.key === key ? { ...item, ...patch } : item)
      )
    },
    [],
  )

  /**
   * startUpload — 上传单个文件（状态机驱动）
   *
   * pending → uploading → done / error
   * 每次进度回调通过 patchItem 精准更新对应文件的 progress 字段
   */
  async function startUpload(item: FileItem): Promise<void> {
    if (!user || !activeLedgerId || !txId) return

    // 标记为上传中
    patchItem(item.key, { status: 'uploading', progress: 0 })

    try {
      const evidence = await uploadEvidence(
        item.file,
        txId,
        activeLedgerId,
        user.uid,
        // 进度回调：函数式更新，无闭包捕获风险
        (percent) => patchItem(item.key, { progress: percent }),
      )
      patchItem(item.key, { status: 'done', progress: 100, result: evidence })
    } catch (e) {
      const msg = e instanceof Error ? e.message : '上传失败，请重试'
      patchItem(item.key, { status: 'error', errorMsg: msg })
      console.error(`[EvidenceUploaderModal] 文件上传失败 key=${item.key}:`, e)
    }
  }

  /**
   * addFiles — 将 FileList 转为 FileItem 并加入队列，同步触发上传
   *
   * 校验规则（每个文件独立校验）：
   *   · 类型：image/* 或 application/pdf
   *   · 大小：≤ 10 MB
   *   · 空文件：拒绝
   *   · 与已在队列中的同名同大小文件：去重（不重复上传）
   */
  function addFiles(rawFiles: FileList | File[]): void {
    const files      = Array.from(rawFiles)
    const rejected:  string[] = []
    const accepted:  FileItem[] = []

    for (const file of files) {
      // 合法性校验
      const validation = validateFile(file)
      if (!validation.valid) {
        rejected.push(`「${file.name}」：${validation.message}`)
        continue
      }

      // 去重检测（同名同大小视为同一文件）
      const isDuplicate = fileItems.some(
        i => i.file.name === file.name && i.file.size === file.size
      )
      if (isDuplicate) {
        rejected.push(`「${file.name}」：已在上传队列中，跳过重复文件`)
        continue
      }

      accepted.push({
        key:      `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        file,
        status:   'pending',
        progress: 0,
      })
    }

    // 显示拒绝原因（3 秒后自动清除）
    if (rejected.length > 0) {
      setRejectMsgs(rejected)
      setTimeout(() => setRejectMsgs([]), 4000)
    }

    if (accepted.length === 0) return

    // 加入队列（合并到现有列表末尾）
    setFileItems(prev => [...prev, ...accepted])

    // 立即并行上传（forEach 不 await，各文件独立运行）
    accepted.forEach(item => { void startUpload(item) })
  }

  // ════════════════════════════════════════════════════════════════
  // § 4  拖拽事件处理（原生 dragover / drop，零第三方库）
  // ════════════════════════════════════════════════════════════════

  /** 拖入时高亮拖拽区域 */
  function handleDragEnter(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  /**
   * handleDragOver — 必须 preventDefault() 才能接收 drop 事件
   * 同时设置 dropEffect 提示用户可以释放
   */
  function handleDragOver(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragging(true)
  }

  /** 拖出时取消高亮（stopPropagation 防止子元素触发导致闪烁）*/
  function handleDragLeave(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.stopPropagation()
    // 只在鼠标真正离开拖拽区域时重置（忽略内部子元素边界触发）
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragging(false)
    }
  }

  /** 文件释放：提取文件列表并加入上传队列 */
  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const { files } = e.dataTransfer
    if (files.length > 0) addFiles(files)
  }

  // ── 文件选择器回调 ─────────────────────────────────────────────
  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const { files } = e.target
    if (files && files.length > 0) {
      addFiles(files)
      // 重置 input value，允许重复选择同一文件
      e.target.value = ''
    }
  }

  // ════════════════════════════════════════════════════════════════
  // § 5  渲染
  // ════════════════════════════════════════════════════════════════

  return (
    // 全屏遮罩层（z-[300] 高于 EjectionBlocker z-[200]，确保治理流程优先）
    <div
      className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center
                 bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >

      {/* ── 模态框面板 ── */}
      <div className="w-full sm:max-w-lg bg-surface-primary rounded-t-2xl sm:rounded-2xl
                      shadow-2xl overflow-hidden
                      max-h-[90vh] flex flex-col">

        {/* ─────── 顶栏 ─────── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3
                        border-b border-border-primary flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-content-primary">📎 补传凭证</h2>
            <p className="text-[11px] text-content-tertiary mt-0.5">
              账单 ID：{txId.slice(0, 16)}…
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-7 h-7 flex items-center justify-center rounded-full
                       text-content-tertiary hover:text-content-primary
                       hover:bg-surface-secondary transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* ─────── 可滚动主体 ─────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ─── 拖拽上传区域 ─── */}
          <div
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={[
              // 布局
              'flex flex-col items-center justify-center gap-2',
              'py-8 rounded-2xl',
              'border-2 border-dashed',
              'cursor-pointer select-none',
              'transition-all duration-200',
              // 拖入高亮 / 静止样式
              isDragging
                ? 'border-primary-500 bg-primary-50 scale-[1.01]'
                : 'border-border-primary bg-surface-secondary hover:border-primary-400 hover:bg-primary-50/50',
            ].join(' ')}
          >
            {/* 图标 */}
            <span className={[
              'text-4xl transition-transform duration-200',
              isDragging ? 'scale-110' : '',
            ].join(' ')}>
              {isDragging ? '⬇️' : '☁️'}
            </span>

            {/* 提示文字 */}
            <div className="text-center">
              <p className={[
                'text-sm font-semibold',
                isDragging ? 'text-primary-600' : 'text-content-secondary',
              ].join(' ')}>
                {isDragging ? '松开即可上传' : '拖放文件到此处'}
              </p>
              <p className="text-xs text-content-tertiary mt-0.5">
                或点击选择文件 · 支持图片和 PDF · 单文件 ≤ 10 MB
              </p>
            </div>
          </div>

          {/* 隐藏的 file input（多选）*/}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="hidden"
            onChange={handleFileInputChange}
          />

          {/* ─── 拒绝原因提示（4 秒自动消失）─── */}
          {rejectMsgs.length > 0 && (
            <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl space-y-1">
              <p className="text-xs font-semibold text-red-600">以下文件已跳过：</p>
              {rejectMsgs.map((msg, i) => (
                <p key={i} className="text-xs text-red-500 leading-snug">{msg}</p>
              ))}
            </div>
          )}

          {/* ─── 上传队列（文件列表 + 进度条）─── */}
          {fileItems.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] text-content-tertiary font-medium">
                上传队列（{fileItems.length} 个文件）
              </p>
              {fileItems.map((item) => (
                <FileProgressRow key={item.key} item={item} />
              ))}
            </div>
          )}

        </div>

        {/* ─────── 底部操作栏 ─────── */}
        <div className="flex items-center justify-between px-5 pt-3 pb-5
                        border-t border-border-primary flex-shrink-0">

          {/* 左：统计摘要 */}
          <div className="text-xs text-content-tertiary">
            {fileItems.length === 0 ? (
              <span>尚未选择文件</span>
            ) : hasUploading ? (
              <span className="text-primary-600 font-medium">
                上传中… {doneCount}/{fileItems.length}
              </span>
            ) : (
              <span className={errorCount > 0 ? 'text-red-500' : 'text-green-600'}>
                {doneCount} 成功
                {errorCount > 0 && `，${errorCount} 失败`}
              </span>
            )}
          </div>

          {/* 右：完成 / 取消按钮 */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-xl text-sm font-medium
                         text-content-secondary hover:text-content-primary
                         hover:bg-surface-secondary transition-colors"
            >
              {allDone ? '关闭' : '取消'}
            </button>

            {/* 选择更多文件（上传完成后展示）*/}
            {allDone && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl text-sm font-medium
                           border border-primary-400 text-primary-600
                           hover:bg-primary-50 transition-colors"
              >
                继续添加
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// § 6  子组件：单文件进度行
// ════════════════════════════════════════════════════════════════

interface FileProgressRowProps {
  item: FileItem
}

function FileProgressRow({ item }: FileProgressRowProps) {
  const { file, status, progress, errorMsg } = item

  // 文件大小格式化
  const sizeText = file.size < 1024 * 100
    ? `${Math.round(file.size / 1024)} KB`
    : `${(file.size / 1024 / 1024).toFixed(1)} MB`

  // 状态图标
  const statusIcon =
    status === 'done'      ? '✅' :
    status === 'error'     ? '❌' :
    status === 'uploading' ? null :   // 上传中显示进度条
    '⏳'                              // pending

  // 进度条颜色
  const barColor =
    status === 'done'  ? 'bg-green-500' :
    status === 'error' ? 'bg-red-500'   :
    'bg-primary-500'

  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-surface-secondary">

      {/* 文件类型图标 */}
      <span className="text-xl leading-none flex-shrink-0 mt-0.5">
        {file.type.startsWith('image/') ? '🖼️' : '📄'}
      </span>

      {/* 主体：文件名 + 进度 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-xs font-medium text-content-primary truncate">
            {file.name}
          </p>
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[10px] text-content-tertiary">{sizeText}</span>
            {statusIcon && <span className="text-sm">{statusIcon}</span>}
            {status === 'uploading' && (
              <span className="text-[10px] text-primary-600 font-semibold tabular-nums w-8 text-right">
                {progress}%
              </span>
            )}
          </div>
        </div>

        {/* 进度条（pending / uploading / done / error 均展示，填充宽度不同）*/}
        <div className="h-1.5 rounded-full bg-surface-tertiary overflow-hidden">
          <div
            className={['h-full rounded-full transition-all duration-300', barColor].join(' ')}
            style={{
              width: `${
                status === 'done'  ? 100 :
                status === 'error' ? 100 :
                status === 'pending' ? 0  :
                progress
              }%`,
            }}
          />
        </div>

        {/* 错误信息 */}
        {status === 'error' && errorMsg && (
          <p className="text-[10px] text-red-500 mt-1 leading-snug">{errorMsg}</p>
        )}
      </div>

    </div>
  )
}
