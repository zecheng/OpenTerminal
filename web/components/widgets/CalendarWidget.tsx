"use client";

import { useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { apiGet, fmt, pctClass } from "../../lib/api";
import { useTerminal } from "../../store/terminal";

type EconEvent = {
  title: string;
  country: string;
  date: string;
  impact: "Low" | "Medium" | "High" | "Holiday";
  forecast: string | null;
  previous: string | null;
  actual: string | null;
};

type EarningsEntry = {
  symbol: string;
  nextEarningsDate: number | null;
  lastEarningsDate: number | null;
  epsForecast: number | null;
};

const IMPACT_CLASS: Record<EconEvent["impact"], string> = {
  High: "down",
  Medium: "amber",
  Low: "dim",
  Holiday: "dim",
};

const TIMEZONES: Array<{ label: string; zone: string | undefined }> = [
  { label: "本地", zone: undefined },
  { label: "UTC", zone: "UTC" },
  { label: "纽约", zone: "America/New_York" },
  { label: "芝加哥", zone: "America/Chicago" },
  { label: "伦敦", zone: "Europe/London" },
  { label: "法兰克福", zone: "Europe/Berlin" },
  { label: "东京", zone: "Asia/Tokyo" },
  { label: "悉尼", zone: "Australia/Sydney" },
];

function EconomicTab() {
  const [minImpact, setMinImpact] = useState<"all" | "medium">("medium");
  const [tz, setTz] = useState<string>("本地");

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["econ-calendar"],
    queryFn: () => apiGet<EconEvent[]>("/api/econ-calendar"),
    refetchInterval: 300_000,
  });

  const events = useMemo(
    () => (minImpact === "all" ? data : data.filter((e) => e.impact === "High" || e.impact === "Medium")),
    [data, minImpact]
  );

  if (error) return <div className="p-2 down">错误: {(error as Error).message}</div>;
  if (isLoading) return <div className="p-2 dim">加载日历中…</div>;

  const zone = TIMEZONES.find((t) => t.label === tz)?.zone;

  return (
    <div>
      <div className="flex gap-1 p-1 items-center flex-wrap">
        <button className={`term-btn ${minImpact === "medium" ? "active" : ""}`} onClick={() => setMinImpact("medium")}>
          高+中
        </button>
        <button className={`term-btn ${minImpact === "all" ? "active" : ""}`} onClick={() => setMinImpact("all")}>
          全部
        </button>
        <span className="w-2" />
        <select
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          className="term-btn !py-0.5 bg-[var(--panel)] cursor-pointer"
        >
          {TIMEZONES.map((t) => (
            <option key={t.label} value={t.label}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>币种</th>
            <th>事件</th>
            <th>预期</th>
            <th>前值</th>
            <th>实际</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={`${e.title}-${e.date}-${i}`}>
              <td className="!text-left dim whitespace-nowrap">
                {new Date(e.date).toLocaleString(undefined, {
                  timeZone: zone,
                  month: "short",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZoneName: "short",
                })}
              </td>
              <td>{e.country}</td>
              <td className={`!text-left ${IMPACT_CLASS[e.impact]}`}>{e.title}</td>
              <td>{e.forecast ?? "—"}</td>
              <td className="dim">{e.previous ?? "—"}</td>
              <td className={e.actual ? "text-[var(--text)]" : "dim"}>{e.actual ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {events.length === 0 && <div className="p-3 dim">此时间段无事件。</div>}
    </div>
  );
}

const fmtDate = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleDateString("zh-CN") : "—");

type EarningsHistoryRow = {
  fiscalQtrEnd: string;
  dateReported: number;
  eps: number | null;
  consensusForecast: number | null;
  surprisePercent: number | null;
  dayAfterChangePercent: number | null;
};

/** Actual vs forecast: beat = green, miss = red, in-line = white. */
function surpriseClass(row: EarningsHistoryRow): string {
  if (row.eps === null || row.consensusForecast === null) return "dim";
  if (row.eps > row.consensusForecast) return "up";
  if (row.eps < row.consensusForecast) return "down";
  return "text-[var(--text)]";
}

function EarningsHistoryRows({ symbol }: { symbol: string }) {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["earnings-history", symbol],
    queryFn: () => apiGet<EarningsHistoryRow[]>(`/api/earnings-history/${symbol}`),
    staleTime: 3_600_000,
  });

  if (error) return <div className="p-2 down">错误: {(error as Error).message}</div>;
  if (isLoading) return <div className="p-2 dim">加载 {symbol} 财报历史中…</div>;
  if (data.length === 0) return <div className="p-2 dim">{symbol} 无财报历史。</div>;

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>季度</th>
          <th>发布日期</th>
          <th>预期</th>
          <th>实际</th>
          <th>超预期</th>
          <th>次日</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.dateReported}>
            <td className="!text-left dim">{row.fiscalQtrEnd}</td>
            <td className="!text-left dim">{fmtDate(row.dateReported)}</td>
            <td className="dim">{row.consensusForecast != null ? `$${row.consensusForecast.toFixed(2)}` : "—"}</td>
            <td className={surpriseClass(row)}>{row.eps != null ? `$${row.eps.toFixed(2)}` : "—"}</td>
            <td className={surpriseClass(row)}>{row.surprisePercent != null ? `${fmt(row.surprisePercent, 1)}%` : "—"}</td>
            <td className={pctClass(row.dayAfterChangePercent)}>
              {row.dayAfterChangePercent != null ? `${fmt(row.dayAfterChangePercent, 1)}%` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EarningsTab() {
  const watchlist = useTerminal((s) => s.watchlist);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["calendar", watchlist],
    queryFn: () => apiGet<EarningsEntry[]>(`/api/calendar?symbols=${watchlist.join(",")}`),
    enabled: watchlist.length > 0,
    staleTime: 3_600_000,
  });

  const sorted = useMemo(
    () =>
      [...data].sort((a, b) => {
        if (a.nextEarningsDate === null && b.nextEarningsDate === null) return 0;
        if (a.nextEarningsDate === null) return 1;
        if (b.nextEarningsDate === null) return -1;
        return a.nextEarningsDate - b.nextEarningsDate;
      }),
    [data]
  );

  if (error) return <div className="p-2 down">错误: {(error as Error).message}</div>;
  if (isLoading) return <div className="p-2 dim">加载财报中…</div>;

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>代码</th>
          <th>上次财报</th>
          <th>下次财报</th>
          <th>EPS 预估</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((e) => (
          <Fragment key={e.symbol}>
            <tr
              onClick={() => setExpanded(expanded === e.symbol ? null : e.symbol)}
              className="cursor-pointer"
              title="点击查看财报历史"
            >
              <td className="!text-left text-[var(--text)] font-bold underline decoration-1">{e.symbol}</td>
              <td className="dim">{fmtDate(e.lastEarningsDate)}</td>
              <td className="amber">{fmtDate(e.nextEarningsDate)}</td>
              <td>{e.epsForecast != null ? `$${e.epsForecast.toFixed(2)}` : "—"}</td>
            </tr>
            {expanded === e.symbol && (
              <tr>
                <td colSpan={4} className="!text-left p-0">
                  <EarningsHistoryRows symbol={e.symbol} />
                </td>
              </tr>
            )}
          </Fragment>
        ))}
        {sorted.length === 0 && (
          <tr>
            <td colSpan={4} className="dim p-3">
              自选股暂无即将到来的财报数据。
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export default function CalendarWidget() {
  const [tab, setTab] = useState<"econ" | "earnings">("econ");

  return (
    <div>
      <div className="flex gap-1 p-1">
        <button className={`term-btn ${tab === "econ" ? "active" : ""}`} onClick={() => setTab("econ")}>
          经济日历
        </button>
        <button className={`term-btn ${tab === "earnings" ? "active" : ""}`} onClick={() => setTab("earnings")}>
          财报
        </button>
      </div>
      {tab === "econ" ? <EconomicTab /> : <EarningsTab />}
    </div>
  );
}
