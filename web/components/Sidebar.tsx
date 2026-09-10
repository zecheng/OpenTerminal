"use client";

import { useTerminal, type WidgetType } from "../store/terminal";

const ITEMS: Array<{ type: WidgetType; label: string; key: string }> = [
  { type: "chart", label: "图表", key: "⌥1" },
  { type: "quote", label: "报价", key: "⌥2" },
  { type: "news", label: "新闻", key: "⌥3" },
  { type: "screener", label: "选股器", key: "⌥4" },
  { type: "heatmap", label: "热力图", key: "⌥5" },
  { type: "crypto", label: "加密货币", key: "⌥6" },
  { type: "options", label: "期权链", key: "⌥7" },
  { type: "portfolio", label: "投资组合", key: "⌥8" },
  { type: "ai", label: "AI 助手", key: "⌥9" },
  { type: "watchlist", label: "自选股", key: "" },
  { type: "macro", label: "宏观", key: "" },
  { type: "calendar", label: "日历", key: "" },
  { type: "insider", label: "内部交易", key: "" },
  { type: "tv", label: "财经直播", key: "" },
  { type: "recap", label: "市场综述", key: "" },
];

export default function Sidebar() {
  const addWidget = useTerminal((s) => s.addWidget);
  const resetWorkspace = useTerminal((s) => s.resetWorkspace);

  return (
    <nav className="w-32 bg-[var(--panel)] border-r border-[var(--border)] flex flex-col shrink-0">
      <div className="dim px-2 py-1 text-[10px] uppercase tracking-wider border-b border-[var(--border)]">
        添加组件
      </div>
      {ITEMS.map((item) => (
        <button
          key={item.type}
          onClick={() => addWidget(item.type)}
          className="text-left px-2 py-1.5 text-[11px] hover:bg-[#1a1a1a] hover:text-[var(--amber)] flex justify-between"
        >
          <span>{item.label}</span>
          <span className="dim text-[9px]">{item.key}</span>
        </button>
      ))}
      <div className="mt-auto border-t border-[var(--border)]">
        <button
          onClick={resetWorkspace}
          className="w-full text-left px-2 py-1.5 text-[11px] dim hover:text-[var(--down)]"
        >
          重置布局
        </button>
      </div>
    </nav>
  );
}
