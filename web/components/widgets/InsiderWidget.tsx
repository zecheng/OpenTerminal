"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, fmtBig } from "../../lib/api";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

type InsiderTransaction = {
  filingDate: string;
  transactionDate: string;
  ownerName: string;
  ownerTitle: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  transactionCode: string;
  acquiredDisposed: "A" | "D" | null;
  shares: number | null;
  pricePerShare: number | null;
  value: number | null;
  sharesOwnedAfter: number | null;
};

// SEC's single-letter transaction codes, the ones that actually show up in practice.
const CODE_LABEL: Record<string, string> = {
  P: "公开市场买入",
  S: "公开市场卖出",
  A: "授予/奖励",
  M: "期权行权",
  G: "赠与",
  F: "税务扣缴",
  C: "转换",
  D: "向发行人处置",
};

export default function InsiderWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["insider", symbol],
    queryFn: () => apiGet<InsiderTransaction[]>(`/api/insider/${symbol}`),
    staleTime: 3_600_000,
  });

  if (error) return <div className="p-2 down">错误: {(error as Error).message}</div>;
  if (isLoading) return <div className="p-2 dim">加载 {symbol} 内部交易中…</div>;

  return (
    <div>
      <table className="data-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>内部人</th>
            <th>职务</th>
            <th>类型</th>
            <th>股数</th>
            <th>价格</th>
            <th>金额</th>
            <th>持有后</th>
          </tr>
        </thead>
        <tbody>
          {data.map((t, i) => (
            <tr key={`${t.ownerName}-${t.transactionDate}-${i}`}>
              <td className="!text-left dim whitespace-nowrap">{t.transactionDate}</td>
              <td className="!text-left">{t.ownerName}</td>
              <td className="!text-left dim truncate max-w-[140px]" title={t.ownerTitle ?? ""}>
                {t.ownerTitle ?? (t.isDirector ? "董事" : t.isTenPercentOwner ? "10%以上股东" : "—")}
              </td>
              <td className={t.acquiredDisposed === "A" ? "up" : t.acquiredDisposed === "D" ? "down" : "dim"}>
                {CODE_LABEL[t.transactionCode] ?? t.transactionCode}
              </td>
              <td>{fmtBig(t.shares)}</td>
              <td>{fmt(t.pricePerShare)}</td>
              <td>{fmtBig(t.value)}</td>
              <td className="dim">{fmtBig(t.sharesOwnedAfter)}</td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td colSpan={8} className="dim p-3">
                {symbol} 近期无公开市场内部交易。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
