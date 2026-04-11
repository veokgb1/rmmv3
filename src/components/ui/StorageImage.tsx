/**
 * StorageImage — 唯一标准 Firebase Storage 图片渲染组件
 *
 * 设计原则：
 *   · 永远不把 URL / path 直接绑给 <img src>
 *   · 接受 storagePath（receipts/xxx.jpg）或完整 Firebase Storage URL
 *     两种来源统一通过 getDownloadURL 解析，获得含 token 的可访问链接
 *   · 提供 loading / error 两种占位 UI
 *
 * 使用场景：
 *   · ConflictDetailPane  —— 凭证大图 / Lightbox
 *   · BillItem            —— 40×40 缩略图
 *   · ConflictCard        —— 36×36 缩略图
 */

import { useState, useEffect }          from 'react'
import { ref as storageRef, getDownloadURL } from 'firebase/storage'
import { storage }                       from '@/config/firebase'

// ── 从 Firebase Storage URL 提取 storagePath ──────────────────
// 输入：https://firebasestorage.googleapis.com/.../o/ENCODED_PATH?alt=media...
// 输出：DECODED_PATH（如 receipts/ledgerId/rowNum/file.jpg）
function toStoragePath(raw: string): string {
  const m = raw.match(/\/o\/([^?#]+)/)
  if (m) return decodeURIComponent(m[1])
  return raw   // 已是相对路径，直接返回
}

// ════════════════════════════════════════════════════════════════
// StorageImage — 通用版（支持任意 className / onClick）
// ════════════════════════════════════════════════════════════════

interface StorageImageProps {
  path:       string
  alt:        string
  className?: string
  style?:     React.CSSProperties
  onClick?:   (e: React.MouseEvent) => void
}

export function StorageImage({ path, alt, className, style, onClick }: StorageImageProps) {
  const [imgSrc,   setImgSrc]   = useState<string | null>(null)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    setImgSrc(null)
    setHasError(false)
    if (!path) { setHasError(true); return }

    let cancelled = false
    getDownloadURL(storageRef(storage, toStoragePath(path)))
      .then(url  => { if (!cancelled) setImgSrc(url)    })
      .catch(()  => { if (!cancelled) setHasError(true) })

    return () => { cancelled = true }
  }, [path])

  if (hasError) {
    return (
      <div className={`flex flex-col items-center justify-center bg-slate-100 ${className ?? ''}`}>
        <span style={{ fontSize: '1rem' }}>🖼️</span>
        <span style={{ fontSize: '8px', color: '#94a3b8', marginTop: 2 }}>加载失败</span>
      </div>
    )
  }

  if (!imgSrc) {
    return (
      <div className={`flex items-center justify-center bg-slate-100 ${className ?? ''}`}>
        <span style={{ fontSize: '8px', color: '#94a3b8' }}>加载中…</span>
      </div>
    )
  }

  return <img src={imgSrc} alt={alt} className={className} style={style} onClick={onClick} />
}

// ════════════════════════════════════════════════════════════════
// ThumbnailImage — 缩略图变体（固定尺寸，带无图占位）
// ════════════════════════════════════════════════════════════════

interface ThumbnailImageProps {
  /** receiptUrls 数组，取第一张显示；空数组时显示占位 */
  urls:       string[]
  /** 缩略图尺寸 class，如 "w-10 h-10" 或 "w-9 h-9" */
  sizeClass?: string
  /** 点击回调（通常用于弹出 Lightbox）*/
  onClick?:   (e: React.MouseEvent) => void
}

export function ThumbnailImage({ urls, sizeClass = 'w-10 h-10', onClick }: ThumbnailImageProps) {
  const firstUrl = urls[0]

  const baseClass = `${sizeClass} rounded-md flex-shrink-0 overflow-hidden`

  if (!firstUrl) {
    return (
      <div className={`${baseClass} flex items-center justify-center bg-slate-100 border border-slate-200`}>
        <svg className="w-4 h-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14
               m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => e.key === 'Enter' && onClick?.(e as unknown as React.MouseEvent)}
      className={`${baseClass} relative border border-slate-200 cursor-pointer
                  hover:ring-2 hover:ring-primary-400 hover:ring-offset-1 transition-all`}
    >
      <StorageImage
        path={firstUrl}
        alt="receipt"
        className="w-full h-full object-cover"
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
      />
      {/* 多图数量徽章：仅当 urls.length > 1 时显示 */}
      {urls.length > 1 && (
        <span
          className="absolute top-0.5 right-0.5
                     min-w-[14px] h-[14px] px-0.5
                     bg-black/60 text-white
                     text-[9px] font-bold leading-[14px]
                     rounded-sm text-center
                     pointer-events-none select-none"
        >
          {urls.length > 9 ? '9+' : urls.length}
        </span>
      )}
    </div>
  )
}
