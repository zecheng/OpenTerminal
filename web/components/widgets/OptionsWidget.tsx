"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, fmtBig } from "../../lib/api";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

type OptionRow = {
  strike: number | null; lastPrice: number | null; bid: number | null; ask: number | null;
  volume: number | null; openInterest: number | null; impliedVolatility?: number | null; inTheMoney: boolean;
};
type Chain = {
  symbol: string; underlyingPrice: number | null; expirationDates: string[];
  selectedDate: string | null; calls: OptionRow[]; puts: OptionRow[];
};

export default function OptionsWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [expiry, setExpiry] = useState<string | undefined>();

  const { data, error, isLoading } = useQuery({
    queryKey: ["options", symbol, expiry],
    queryFn: () => apiGet<Chain>(`/api/options/${symbol}${expiry ? `?expiry=${encodeURIComponent(expiry)}` : ""}`),
    refetchInterval: 20_000,
    retry: 0,
  });

  if (error)
    return (
      <div className="p-2">
        <div className="down">{symbol} 期权链不可用</div>
        <div className="dim">{(error as Error).message}</div>
      </div>
    );
  if (isLoading || !data) return <div className="p-2 dim">加载期权链中…</div>;

  const byStrike = new Map<number, { call?: OptionRow; put?: OptionRow }>();
  for (const c of data.calls) if (c.strike !== null) byStrike.set(c.strike, { ...byStrike.get(c.strike), call: c });
  for (const p of data.puts) if (p.strike !== null) byStrike.set(p.strike, { ...byStrike.get(p.strike), put: p });
  const strikes = [...byStrike.keys()].sort((a, b) => a - b);

  return (
    <div>
      <div className="flex gap-2 items-center p-1">
        <span className="dim">标的价</span>
        <span className="amber font-bold">{fmt(data.underlyingPrice)}</span>
        <span className="dim ml-2">到期日</span>
        <select
          value={expiry ?? data.selectedDate ?? ""}
          onChange={(e) => setExpiry(e.target.value)}
        >
          {data.expirationDates.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th colSpan={5} className="!text-center up">认购</th>
            <th className="!text-center">行权价</th>
            <th colSpan={5} className="!text-center down">认沽</th>
          </tr>
          <tr>
            <th>最新</th><th>买价</th><th>卖价</th><th>量</th><th>持仓·隐波</th>
            <th></th>
            <th>最新</th><th>买价</th><th>卖价</th><th>量</th><th>持仓·隐波</th>
          </tr>
        </thead>
        <tbody>
          {strikes.map((strike) => {
            const { call, put } = byStrike.get(strike)!;
            return (
              <tr key={strike}>
                <td className={call?.inTheMoney ? "bg-[#0d2010]" : ""}>{fmt(call?.lastPrice)}</td>
                <td className={call?.inTheMoney ? "bg-[#0d2010]" : ""}>{fmt(call?.bid)}</td>
                <td className={call?.inTheMoney ? "bg-[#0d2010]" : ""}>{fmt(call?.ask)}</td>
                <td className={call?.inTheMoney ? "bg-[#0d2010]" : ""}>{fmtBig(call?.volume)}</td>
                <td className={call?.inTheMoney ? "bg-[#0d2010]" : ""}>
                  {fmtBig(call?.openInterest)} · {call?.impliedVolatility ? fmt(call.impliedVolatility * 100, 0) + "%" : "—"}
                </td>
                <td className="!text-center font-bold amber">{fmt(strike)}</td>
                <td className={put?.inTheMoney ? "bg-[#200d0d]" : ""}>{fmt(put?.lastPrice)}</td>
                <td className={put?.inTheMoney ? "bg-[#200d0d]" : ""}>{fmt(put?.bid)}</td>
                <td className={put?.inTheMoney ? "bg-[#200d0d]" : ""}>{fmt(put?.ask)}</td>
                <td className={put?.inTheMoney ? "bg-[#200d0d]" : ""}>{fmtBig(put?.volume)}</td>
                <td className={put?.inTheMoney ? "bg-[#200d0d]" : ""}>
                  {fmtBig(put?.openInterest)} · {put?.impliedVolatility ? fmt(put.impliedVolatility * 100, 0) + "%" : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
