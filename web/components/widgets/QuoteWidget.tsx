"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, fmtBig, pctClass, type Quote } from "../../lib/api";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import Flash from "../Flash";

type ShortVolume = { date: string; shortVolume: number; shortExemptVolume: number; totalVolume: number; shortVolumePercent: number };

export default function QuoteWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const { data, error } = useQuery({
    queryKey: ["quote", symbol],
    queryFn: async () => (await apiGet<Quote[]>(`/api/quotes?symbols=${symbol}`))[0],
    refetchInterval: 1_000,
  });
  // FINRA's Reg SHO file only updates once a day (next-morning), so no point polling it fast.
  const { data: shortVol } = useQuery({
    queryKey: ["short-volume", symbol],
    queryFn: () => apiGet<ShortVolume | null>(`/api/short-volume/${symbol}`),
    staleTime: 3_600_000,
  });

  if (error) return <div className="p-2 down">错误: {(error as Error).message}</div>;
  if (!data) return <div className="p-2 dim">加载 {symbol} 中…</div>;

  const rows: Array<[string, string, string?]> = [
    ["今开", fmt(data.open)],
    ["最高", fmt(data.high)],
    ["最低", fmt(data.low)],
    ["昨收", fmt(data.previousClose)],
    ["买价", fmt(data.bid)],
    ["卖价", fmt(data.ask)],
    ["成交量", fmtBig(data.volume)],
    ["3月均量", fmtBig(data.avgVolume)],
    ...(shortVol ? ([["做空占比 %", fmt(shortVol.shortVolumePercent, 1) + "%"]] as Array<[string, string]>) : []),
    ["总市值", fmtBig(data.marketCap)],
    ["市盈率 (ttm)", fmt(data.pe)],
    ["每股收益 (ttm)", fmt(data.eps)],
    ["股息率", data.dividendYield !== null ? fmt(data.dividendYield * 100) + "%" : "—"],
    ["52周最高", fmt(data.week52High)],
    ["52周最低", fmt(data.week52Low)],
    ["Beta", fmt(data.beta)],
    ["总股本", fmtBig(data.sharesOutstanding)],
  ];

  return (
    <div className="p-2">
      <div className="flex items-baseline gap-3 mb-1">
        <Flash value={data.price} className="text-xl font-bold">{fmt(data.price)}</Flash>
        <Flash value={data.changePercent} className={`${pctClass(data.changePercent)} text-sm`}>
          {data.change !== null && data.change >= 0 ? "+" : ""}
          {fmt(data.change)} ({fmt(data.changePercent)}%)
        </Flash>
        <span className="dim text-[10px] ml-auto">
          {data.exchange ?? ""} · {data.currency ?? ""} · {data.source}
        </span>
      </div>
      <div className="dim text-[11px] mb-2 truncate">{data.name}</div>
      <div className="grid grid-cols-2 gap-x-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between border-b border-[#161616] py-0.5">
            <span className="dim">{label}</span>
            <span>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
