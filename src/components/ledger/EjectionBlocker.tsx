// EjectionBlocker — 实时越权阻断层 (S18)
//
// 触发条件：useLedgerStore.ejectionInfo 非 null
//   即：onSnapshot 检测到当前用户已被移出正在查看的账套
//
// 设计原则：
//   ✦ 不可关闭（无遮罩点击关闭，无 ESC 退出）
//   ✦ z-[200] 高于所有业务 Modal（z-50），确保覆盖一切
//   ✦ 显示被踢出的账套名称，信息精确
//   ✦ 唯一出口：「我已知晓」按钮 → clearEjection() → 正常使用剩余账套
//   ✦ 若仍有其他账套访问权限，提示用户已自动切换
//
// 渲染位置：App.tsx 的 MainApp 组件（全局，所有路由之上）

import { useLedgerStore }  from '@/store/ledgerStore'
import { useLedger }       from '@/hooks/useLedger'

export default function EjectionBlocker() {
  const ejectionInfo  = useLedgerStore(s => s.ejectionInfo)
  const clearEjection = useLedgerStore(s => s.clearEjection)
  const { ledgers, activeLedger } = useLedger()

  // 无阻断事件时不渲染任何内容
  if (!ejectionInfo) return null

  // 踢出后是否还有其他可用账套
  const hasRemainingLedgers = ledgers.length > 0

  return (
    // fixed inset-0 z-[200] — 高于所有 Modal/Toast，物理覆盖整个视口
    // pointer-events-auto — 确保阻断层吸收所有点击事件，下层无法操作
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center
                 bg-gray-950/95 backdrop-blur-md"
      // 明确阻止冒泡：即使套了其他弹窗，此层也不允许穿透关闭
      onClick={e => e.stopPropagation()}
    >
      {/* 阻断卡片 */}
      <div
        className="w-[90%] max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden
                   animate-[slideUp_0.3s_ease-out]"
      >
        {/* 红色警示头部 */}
        <div className="bg-gradient-to-r from-red-600 to-rose-600 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            {/* 警告图标圆圈 */}
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center
                            justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24"
                   stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948
                     3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949
                     3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold leading-tight">访问权限已撤销</h2>
              <p className="text-red-100 text-xs mt-0.5">您已被该账本管理员移出</p>
            </div>
          </div>
        </div>

        {/* 内容区 */}
        <div className="px-6 py-5 space-y-4">

          {/* 被踢出的账套信息 */}
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <p className="text-xs text-red-500 font-semibold mb-1">已失去访问权限的账本</p>
            <p className="text-sm font-bold text-red-700">
              「{ejectionInfo.ledgerName}」
            </p>
            <p className="text-[11px] text-red-400 mt-1">
              {new Date(ejectionInfo.ejectedAt).toLocaleString('zh-CN', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit',
              })} 权限已更新
            </p>
          </div>

          {/* 当前状态说明 */}
          <div className="space-y-2">
            {hasRemainingLedgers ? (
              <>
                <p className="text-sm text-gray-700 leading-relaxed">
                  该账本的所有数据已从您的设备上清除，您无法继续查看或录入其账单。
                </p>
                <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-100
                                rounded-xl px-3 py-2.5">
                  <span className="text-emerald-500 flex-shrink-0 text-base mt-0.5">✓</span>
                  <p className="text-xs text-emerald-700 leading-relaxed">
                    已自动切换至账本
                    <span className="font-bold mx-1">「{activeLedger?.name ?? '默认账本'}」</span>
                    您仍可正常使用。
                  </p>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-700 leading-relaxed">
                该账本的所有数据已从您的设备上清除。
                目前您没有任何可访问的账本，可前往设置创建新账本或联系相关管理员。
              </p>
            )}
          </div>

          {/* 唯一出口按钮 */}
          <button
            onClick={clearEjection}
            className="w-full py-3.5 rounded-xl bg-gray-900 text-white text-sm font-bold
                       hover:bg-gray-800 active:scale-[0.98] transition-all shadow-sm"
          >
            我已知晓，继续使用
          </button>
        </div>
      </div>
    </div>
  )
}
