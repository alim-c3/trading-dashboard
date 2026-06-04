"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  format, parseISO, isWithinInterval,
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  startOfYear, endOfYear,
} from "date-fns";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Plus, X, BookOpen, Target, AlertTriangle, Lightbulb,
  Activity, DollarSign, BarChart2, Award, Trash2,
  TrendingUp, Calendar, ChevronDown,
} from "lucide-react";
import type { Trade, Lesson, LessonCategory, LessonSeverity } from "./types";

// ─── helpers ────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  (n >= 0 ? "+" : "") + n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const pct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";

function tradePnl(t: Trade): number {
  if (!t.exitPrice) return 0;
  const raw = (t.exitPrice - t.entryPrice) * t.shares;
  const gross = t.direction === "SHORT" ? -raw : raw;
  return gross - (t.commission ?? 0);
}

// ─── Period helpers ──────────────────────────────────────────────────────────
type Period = "today" | "week" | "month" | "ytd" | "all";

const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  week:  "This Week",
  month: "This Month",
  ytd:   "Year to Date",
  all:   "All Time",
};

function getInterval(period: Period): { start: Date; end: Date } | null {
  const now = new Date();
  switch (period) {
    case "today": return { start: startOfDay(now),   end: endOfDay(now) };
    case "week":  return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    case "month": return { start: startOfMonth(now), end: endOfMonth(now) };
    case "ytd":   return { start: startOfYear(now),  end: endOfYear(now) };
    case "all":   return null;
  }
}

function filterByPeriod(trades: Trade[], period: Period): Trade[] {
  const interval = getInterval(period);
  if (!interval) return trades;
  return trades.filter(t => isWithinInterval(parseISO(t.date), interval));
}

// ─── Seed trades ─────────────────────────────────────────────────────────────
const SEED_TRADES: Trade[] = [
  {
    id: "seed-1", date: "2026-06-04", ticker: "BB", direction: "LONG",
    entryPrice: 9.95, exitPrice: 10.076, shares: 3000, commission: 1.21,
    status: "CLOSED", setup: "Momentum",
    notes: "Bought 3000 shares, sold into strength",
    createdAt: "2026-06-04T10:00:00Z",
  },
  {
    id: "seed-2", date: "2026-06-04", ticker: "BB", direction: "LONG",
    entryPrice: 9.01, exitPrice: 9.64, shares: 2500, commission: 0.99,
    status: "CLOSED", setup: "Pullback re-entry",
    notes: "Second BB trade on same day, bought dip",
    createdAt: "2026-06-04T11:00:00Z",
  },
  {
    id: "seed-3", date: "2026-06-02", ticker: "HPE", direction: "SHORT",
    entryPrice: 59.9205, exitPrice: 56.0925, shares: 300, commission: 0.43,
    status: "CLOSED", setup: "Short sell — covered at blended avg",
    notes: "Sold short 300 @ 59.9205, covered: 150 @ 55.605 + 150 @ 56.58 (blended exit $56.0925)",
    createdAt: "2026-06-02T10:00:00Z",
  },
];

// ─── Config ──────────────────────────────────────────────────────────────────
const SEVERITY_CONFIG: Record<LessonSeverity, { color: string; bg: string; icon: JSX.Element; label: string }> = {
  critical: { color: "text-red-400",    bg: "bg-red-400/10 border-red-400/30",       icon: <AlertTriangle size={14} />, label: "Mistake"   },
  warning:  { color: "text-yellow-400", bg: "bg-yellow-400/10 border-yellow-400/30", icon: <Target size={14} />,        label: "Watch Out" },
  insight:  { color: "text-indigo-400", bg: "bg-indigo-400/10 border-indigo-400/30", icon: <Lightbulb size={14} />,     label: "Insight"   },
};

const CATEGORY_COLORS: Record<LessonCategory, string> = {
  "Risk Management": "#6366f1",
  "Entry":           "#06b6d4",
  "Exit":            "#10b981",
  "Psychology":      "#f59e0b",
  "Setup":           "#8b5cf6",
  "Other":           "#6b7280",
};

// ─── Period Dropdown ──────────────────────────────────────────────────────────
function PeriodDropdown({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors bg-indigo-500/10 hover:bg-indigo-500/20 px-2 py-1 rounded-md"
      >
        <Calendar size={11} />
        {PERIOD_LABELS[period]}
        <ChevronDown size={11} className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[150px] rounded-xl border border-gray-700 bg-gray-900 shadow-2xl overflow-hidden">
          {(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([p, label]) => (
            <button
              key={p}
              onClick={() => { onChange(p); setOpen(false); }}
              className={`w-full text-left px-4 py-2.5 text-xs font-semibold transition-colors flex items-center justify-between gap-3
                ${period === p
                  ? "bg-indigo-600/20 text-indigo-300"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"}`}
            >
              {label}
              {period === p && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, icon, positive, neutral, topRight,
}: {
  label: string; value: string; sub?: string;
  icon?: React.ReactNode; positive?: boolean; neutral?: boolean;
  topRight?: React.ReactNode;
}) {
  const color = neutral ? "text-gray-300" : positive ? "text-emerald-400" : "text-red-400";
  const glow  = neutral ? "" : positive ? "glow-green" : "glow-red";
  return (
    <div className={`rounded-xl p-5 border border-gray-800 bg-gray-900 ${glow}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold tracking-widest uppercase text-gray-500">{label}</span>
        {topRight ? topRight : <span className="text-gray-600">{icon}</span>}
      </div>
      <div className={`text-2xl font-bold font-mono ${color} animate-count`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

// ─── Trade Row ───────────────────────────────────────────────────────────────
function TradeRow({ trade, onDelete }: { trade: Trade; onDelete: (id: string) => void }) {
  const pnl    = tradePnl(trade);
  const isPos  = pnl >= 0;
  const pnlPct = trade.exitPrice
    ? ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100 * (trade.direction === "SHORT" ? -1 : 1)
    : null;

  return (
    <div className="grid grid-cols-[80px_90px_70px_90px_90px_80px_1fr_36px] gap-2 items-center px-4 py-3 rounded-lg border border-gray-800 bg-gray-900/60 hover:bg-gray-900 transition-colors text-sm">
      <span className="text-gray-400 text-xs">{format(parseISO(trade.date), "MMM d")}</span>
      <span className="font-bold text-white tracking-wide">{trade.ticker}</span>
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full w-fit ${trade.direction === "LONG" ? "bg-emerald-400/10 text-emerald-400" : "bg-red-400/10 text-red-400"}`}>
        {trade.direction}
      </span>
      <span className="font-mono text-gray-300">${trade.entryPrice.toFixed(2)}</span>
      <span className="font-mono text-gray-300">
        {trade.exitPrice ? `$${trade.exitPrice.toFixed(2)}` : <span className="text-yellow-400 text-xs">OPEN</span>}
      </span>
      <span className="font-mono text-gray-400">{trade.shares.toLocaleString()}</span>
      <div>
        {trade.exitPrice ? (
          <span className={`font-mono font-bold ${isPos ? "text-emerald-400" : "text-red-400"}`}>
            {fmt(pnl)}{" "}
            {pnlPct !== null && <span className="text-xs opacity-70">({pct(pnlPct)})</span>}
            {trade.commission > 0 && <span className="text-gray-600 text-xs ml-1">-${trade.commission.toFixed(2)} comm</span>}
          </span>
        ) : (
          <span className="text-yellow-400 text-xs font-semibold">OPEN</span>
        )}
        {trade.notes && <p className="text-gray-500 text-xs truncate max-w-[200px]">{trade.notes}</p>}
      </div>
      <button onClick={() => onDelete(trade.id)} className="text-gray-700 hover:text-red-400 transition-colors">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

// ─── Lesson Card ─────────────────────────────────────────────────────────────
function LessonCard({ lesson, onDelete }: { lesson: Lesson; onDelete: (id: string) => void }) {
  const cfg = SEVERITY_CONFIG[lesson.severity];
  return (
    <div className={`relative rounded-xl p-4 border ${cfg.bg} group`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`flex items-center gap-1 text-xs font-semibold ${cfg.color}`}>
            {cfg.icon} {cfg.label}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400"
            style={{ borderLeft: `3px solid ${CATEGORY_COLORS[lesson.category]}` }}>
            {lesson.category}
          </span>
          <span className="text-xs text-gray-600">{format(parseISO(lesson.date), "MMM d, yyyy")}</span>
        </div>
        <button onClick={() => onDelete(lesson.id)} className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all">
          <Trash2 size={13} />
        </button>
      </div>
      <h4 className="mt-2 font-semibold text-white text-sm">{lesson.title}</h4>
      <p className="mt-1 text-gray-400 text-xs leading-relaxed">{lesson.description}</p>
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────
export default function Dashboard() {
  const [trades,  setTrades]  = useState<Trade[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [tab,     setTab]     = useState<"trades" | "lessons" | "analytics">("trades");
  const [period,  setPeriod]  = useState<Period>("all");
  const [showTradeForm,  setShowTradeForm]  = useState(false);
  const [showLessonForm, setShowLessonForm] = useState(false);
  const [lessonFilter,   setLessonFilter]   = useState<LessonSeverity | "all">("all");

  // ─── Persist / seed ────────────────────────────────────────────────────────
  useEffect(() => {
    const t = localStorage.getItem("trades");
    const l = localStorage.getItem("lessons");
    if (t) { setTrades(JSON.parse(t)); }
    else   { setTrades(SEED_TRADES); localStorage.setItem("trades", JSON.stringify(SEED_TRADES)); }
    if (l) setLessons(JSON.parse(l));
  }, []);

  const saveTrades  = useCallback((t: Trade[])  => { setTrades(t);  localStorage.setItem("trades",  JSON.stringify(t)); }, []);
  const saveLessons = useCallback((l: Lesson[]) => { setLessons(l); localStorage.setItem("lessons", JSON.stringify(l)); }, []);

  // ─── Period-scoped stats ───────────────────────────────────────────────────
  const allClosed    = trades.filter(t => t.status === "CLOSED");
  const periodClosed = filterByPeriod(allClosed, period);

  const periodPnl    = periodClosed.reduce((s, t) => s + tradePnl(t), 0);
  const periodWins   = periodClosed.filter(t => tradePnl(t) > 0);
  const periodLosses = periodClosed.filter(t => tradePnl(t) < 0);
  const winRate      = periodClosed.length ? (periodWins.length / periodClosed.length) * 100 : 0;
  const avgWin       = periodWins.length   ? periodWins.reduce((s, t)   => s + tradePnl(t), 0) / periodWins.length   : 0;
  const avgLoss      = periodLosses.length ? periodLosses.reduce((s, t) => s + tradePnl(t), 0) / periodLosses.length : 0;
  const profitFactor = Math.abs(avgLoss) > 0 ? avgWin / Math.abs(avgLoss) : 0;

  // Equity curve — always all-time for visual context
  const equityCurve = (() => {
    const sorted = [...allClosed].sort((a, b) => a.date.localeCompare(b.date));
    let cum = 0;
    return sorted.map(t => ({
      date: format(parseISO(t.date), "MM/dd"),
      cum:  (cum += tradePnl(t)),
    }));
  })();

  // Daily bars — period-scoped
  const dailyMap: Record<string, number> = {};
  periodClosed.forEach(t => { dailyMap[t.date] = (dailyMap[t.date] || 0) + tradePnl(t); });
  const dailyBars = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, pnl]) => ({ date: format(parseISO(date), "MM/dd"), pnl }));

  // Lesson category counts
  const catCount: Partial<Record<LessonCategory, number>> = {};
  lessons.forEach(l => { catCount[l.category] = (catCount[l.category] || 0) + 1; });

  // ─── Trades tab: filtered by period ───────────────────────────────────────
  const displayTrades  = [...filterByPeriod(trades, period)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const displayLessons = lessonFilter === "all" ? lessons : lessons.filter(l => l.severity === lessonFilter);

  const periodSub = `${periodClosed.length} trade${periodClosed.length !== 1 ? "s" : ""}  ·  ${periodWins.length}W / ${periodLosses.length}L`;

  return (
    <div className="min-h-screen bg-[#0a0e1a]">

      {/* ── Header ── */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center">
              <Activity size={16} className="text-white" />
            </div>
            <span className="font-bold text-white text-lg tracking-tight">TradeLog</span>
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500 ml-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />
              Live
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 hidden md:block">{format(new Date(), "EEEE, MMM d yyyy")}</span>
            <button
              onClick={() => { setShowTradeForm(true); setShowLessonForm(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
            >
              <Plus size={14} /> Log Trade
            </button>
            <button
              onClick={() => { setShowLessonForm(true); setShowTradeForm(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold transition-colors"
            >
              <BookOpen size={14} /> Add Lesson
            </button>
            <button
              title="Reset to seed trades"
              onClick={() => { if (confirm("Reset trades to your original 3 trades?")) saveTrades(SEED_TRADES); }}
              className="px-2 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-600 hover:text-gray-400 text-xs transition-colors"
            >
              ↺
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

          {/* P&L — with period dropdown */}
          <div className={`rounded-xl p-5 border border-gray-800 bg-gray-900 ${periodPnl > 0 ? "glow-green" : periodPnl < 0 ? "glow-red" : ""}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold tracking-widest uppercase text-gray-500">P&amp;L</span>
              <PeriodDropdown period={period} onChange={setPeriod} />
            </div>
            <div className={`text-2xl font-bold font-mono animate-count ${periodPnl > 0 ? "text-emerald-400" : periodPnl < 0 ? "text-red-400" : "text-gray-300"}`}>
              {periodClosed.length === 0 ? "—" : fmt(periodPnl)}
            </div>
            <div className="mt-1 text-xs text-gray-500">{periodSub}</div>
          </div>

          {/* Win Rate */}
          <StatCard
            label="Win Rate"
            value={periodClosed.length ? `${winRate.toFixed(1)}%` : "—"}
            sub={`${PERIOD_LABELS[period]}  ·  ${periodWins.length}W / ${periodLosses.length}L`}
            icon={<Award size={16} />}
            positive={winRate >= 50}
            neutral={periodClosed.length === 0}
          />

          {/* Profit Factor */}
          <StatCard
            label="Profit Factor"
            value={profitFactor > 0 ? profitFactor.toFixed(2) : "—"}
            sub={`Avg W: ${avgWin > 0 ? fmt(avgWin) : "—"}`}
            icon={<BarChart2 size={16} />}
            positive={profitFactor >= 1}
            neutral={profitFactor === 0}
          />

          {/* Trades */}
          <StatCard
            label="Trades"
            value={String(periodClosed.length)}
            sub={`All time: ${allClosed.length} closed`}
            icon={<TrendingUp size={16} />}
            positive={periodPnl > 0}
            neutral={periodClosed.length === 0}
          />
        </div>

        {/* ── Equity Curve ── */}
        {equityCurve.length > 1 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500">Equity Curve</h3>
              <span className="text-xs text-gray-600">All time</span>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={equityCurve}>
                <defs>
                  <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={periodPnl >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={periodPnl >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, color: "#f9fafb", fontSize: 12 }}
                  formatter={(v: number) => [fmt(v), "Cumulative P&L"]}
                />
                <Area type="monotone" dataKey="cum" stroke={periodPnl >= 0 ? "#10b981" : "#ef4444"} strokeWidth={2} fill="url(#pnlGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="flex gap-1 border-b border-gray-800">
          {(["trades", "analytics", "lessons"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-semibold capitalize transition-colors border-b-2 -mb-px
                ${tab === t ? "border-indigo-500 text-white" : "border-transparent text-gray-500 hover:text-gray-300"}`}>
              {t === "lessons" ? "Lessons Learned" : t.charAt(0).toUpperCase() + t.slice(1)}
              {t === "trades"  && displayTrades.length > 0 && <span className="ml-2 text-xs bg-gray-800 px-1.5 py-0.5 rounded-full text-gray-400">{displayTrades.length}</span>}
              {t === "lessons" && lessons.length > 0        && <span className="ml-2 text-xs bg-gray-800 px-1.5 py-0.5 rounded-full text-gray-400">{lessons.length}</span>}
            </button>
          ))}
        </div>

        {/* ── Trades Tab ── */}
        {tab === "trades" && (
          <div className="space-y-3">
            {period !== "all" && (
              <div className="flex items-center justify-between px-4 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                <span className="text-xs text-indigo-300 flex items-center gap-1.5">
                  <Calendar size={12} />
                  Showing <strong>{PERIOD_LABELS[period]}</strong>
                  {" · "}
                  <span className={`font-mono font-bold ${periodPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {fmt(periodPnl)}
                  </span>
                </span>
                <button onClick={() => setPeriod("all")} className="text-xs text-indigo-400 hover:text-white transition-colors flex items-center gap-1">
                  <X size={11} /> Show all
                </button>
              </div>
            )}

            {displayTrades.length === 0 ? (
              <div className="text-center py-16 text-gray-600">
                <Activity size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm">
                  {period !== "all"
                    ? <><strong className="text-gray-400">{PERIOD_LABELS[period]}</strong> has no trades. <button className="underline text-indigo-400" onClick={() => setPeriod("all")}>Show all</button></>
                    : <>No trades yet. Click <strong className="text-gray-400">Log Trade</strong> to get started.</>}
                </p>
              </div>
            ) : (
              <>
                <div className="hidden md:grid grid-cols-[80px_90px_70px_90px_90px_80px_1fr_36px] gap-2 px-4 py-2 text-xs font-semibold tracking-widest uppercase text-gray-600">
                  <span>Date</span><span>Ticker</span><span>Dir</span>
                  <span>Entry</span><span>Exit</span><span>Shares</span>
                  <span>P&amp;L</span><span />
                </div>
                <div className="space-y-2">
                  {displayTrades.map(t => (
                    <TradeRow key={t.id} trade={t} onDelete={id => saveTrades(trades.filter(x => x.id !== id))} />
                  ))}
                </div>
                {displayTrades.filter(t => t.status === "CLOSED").length > 1 && (
                  <div className="flex justify-end px-4 pt-2 border-t border-gray-800">
                    <span className="text-xs text-gray-500">
                      Period total:{" "}
                      <span className={`font-mono font-bold ${periodPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fmt(periodPnl)}
                      </span>
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Analytics Tab ── */}
        {tab === "analytics" && (
          <div className="space-y-6">
            {periodClosed.length === 0 ? (
              <div className="text-center py-16 text-gray-600">
                <BarChart2 size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm">No closed trades for <strong className="text-gray-400">{PERIOD_LABELS[period]}</strong>.</p>
              </div>
            ) : (
              <>
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">
                      Daily P&amp;L — {PERIOD_LABELS[period]}
                    </h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={dailyBars}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                        <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                        <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, color: "#f9fafb", fontSize: 12 }}
                          formatter={(v: number) => [fmt(v), "P&L"]} />
                        <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                          {dailyBars.map((entry, i) => <Cell key={i} fill={entry.pnl >= 0 ? "#10b981" : "#ef4444"} fillOpacity={0.85} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">P&amp;L per Trade</h3>
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {[...periodClosed].sort((a, b) => tradePnl(b) - tradePnl(a)).map(t => {
                        const p = tradePnl(t);
                        const maxAbs = Math.max(...periodClosed.map(x => Math.abs(tradePnl(x))));
                        const barW = maxAbs > 0 ? (Math.abs(p) / maxAbs) * 100 : 0;
                        return (
                          <div key={t.id} className="flex items-center gap-2 text-xs">
                            <span className="w-16 text-gray-400 font-mono">{t.ticker}</span>
                            <div className="flex-1 relative h-5 flex items-center">
                              <div className={`h-4 rounded absolute ${p >= 0 ? "bg-emerald-500/30" : "bg-red-500/30"}`}
                                style={{ width: `${barW}%`, [p >= 0 ? "left" : "right"]: "50%", maxWidth: "50%" }} />
                              <span className={`absolute ${p >= 0 ? "left-[52%]" : "right-[52%]"} font-mono font-bold ${p >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {fmt(p)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "Best Trade",  value: fmt(Math.max(...periodClosed.map(tradePnl))), pos: true  },
                    { label: "Worst Trade", value: fmt(Math.min(...periodClosed.map(tradePnl))), pos: false },
                    { label: "Avg Win",     value: avgWin  > 0 ? fmt(avgWin)  : "—", pos: true  },
                    { label: "Avg Loss",    value: avgLoss < 0 ? fmt(avgLoss) : "—", pos: false },
                  ].map(s => (
                    <div key={s.label} className="rounded-xl p-4 border border-gray-800 bg-gray-900 text-center">
                      <div className="text-xs text-gray-500 mb-1">{s.label}</div>
                      <div className={`text-lg font-bold font-mono ${s.pos ? "text-emerald-400" : "text-red-400"}`}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Lessons Tab ── */}
        {tab === "lessons" && (
          <div className="space-y-4">
            {lessons.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500">Filter:</span>
                {(["all", "critical", "warning", "insight"] as const).map(f => (
                  <button key={f} onClick={() => setLessonFilter(f)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors
                      ${lessonFilter === f ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-300"}`}>
                    {f === "all" ? "All" : SEVERITY_CONFIG[f].label}
                    {f !== "all" && <span className="ml-1.5 opacity-60">{lessons.filter(l => l.severity === f).length}</span>}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-3 flex-wrap">
                  {Object.entries(catCount).map(([cat, cnt]) => (
                    <span key={cat} className="flex items-center gap-1 text-xs text-gray-500">
                      <span className="w-2 h-2 rounded-full" style={{ background: CATEGORY_COLORS[cat as LessonCategory] }} />
                      {cat} ({cnt})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {displayLessons.length === 0 ? (
              <div className="text-center py-16 text-gray-600">
                <BookOpen size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm">No lessons yet. Track mistakes and insights to grow as a trader.</p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {[...displayLessons].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(l => (
                  <LessonCard key={l.id} lesson={l} onDelete={id => saveLessons(lessons.filter(x => x.id !== id))} />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {showTradeForm && (
        <TradeForm
          trades={trades}
          onSave={t => { saveTrades([...trades, t]); setShowTradeForm(false); }}
          onClose={() => setShowTradeForm(false)}
        />
      )}
      {showLessonForm && (
        <LessonForm
          trades={trades}
          onSave={l => { saveLessons([...lessons, l]); setShowLessonForm(false); }}
          onClose={() => setShowLessonForm(false)}
        />
      )}
    </div>
  );
}

// ─── Trade Form ───────────────────────────────────────────────────────────────
function TradeForm({ trades, onSave, onClose }: {
  trades: Trade[]; onSave: (t: Trade) => void; onClose: () => void;
}) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    ticker: "", direction: "LONG" as "LONG" | "SHORT",
    entryPrice: "", exitPrice: "", shares: "", commission: "",
    notes: "", setup: "",
  });

  const pnlPreview = (() => {
    const en = parseFloat(form.entryPrice), ex = parseFloat(form.exitPrice);
    const sh = parseFloat(form.shares),     cm = parseFloat(form.commission) || 0;
    if (!en || !ex || !sh) return null;
    return (form.direction === "SHORT" ? -(ex - en) * sh : (ex - en) * sh) - cm;
  })();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.ticker || !form.entryPrice || !form.shares) return;
    onSave({
      id: uuidv4(), date: form.date, ticker: form.ticker.toUpperCase(),
      direction: form.direction,
      entryPrice: parseFloat(form.entryPrice),
      exitPrice:  form.exitPrice ? parseFloat(form.exitPrice) : null,
      shares:     parseFloat(form.shares),
      commission: parseFloat(form.commission) || 0,
      status:     form.exitPrice ? "CLOSED" : "OPEN",
      notes: form.notes, setup: form.setup,
      createdAt: new Date().toISOString(),
    });
  };

  const f = "bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 w-full";

  return (
    <Modal title="Log Trade" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Date</label>
            <input type="date" className={f} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
          </div>
          <div><label className="label">Ticker</label>
            <input className={f} placeholder="AAPL" value={form.ticker} onChange={e => setForm({ ...form, ticker: e.target.value })} required />
          </div>
        </div>
        <div>
          <label className="label">Direction</label>
          <div className="flex gap-2">
            {(["LONG", "SHORT"] as const).map(d => (
              <button key={d} type="button" onClick={() => setForm({ ...form, direction: d })}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors
                  ${form.direction === d
                    ? d === "LONG" ? "bg-emerald-500/20 border border-emerald-500 text-emerald-400" : "bg-red-500/20 border border-red-500 text-red-400"
                    : "bg-gray-800 border border-gray-700 text-gray-500"}`}>
                {d === "LONG" ? "▲ LONG" : "▼ SHORT"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Entry $</label>
            <input type="number" step="0.0001" className={f} placeholder="0.00" value={form.entryPrice} onChange={e => setForm({ ...form, entryPrice: e.target.value })} required />
          </div>
          <div><label className="label">Exit $</label>
            <input type="number" step="0.0001" className={f} placeholder="0.00" value={form.exitPrice} onChange={e => setForm({ ...form, exitPrice: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Shares / Qty</label>
            <input type="number" step="1" className={f} placeholder="100" value={form.shares} onChange={e => setForm({ ...form, shares: e.target.value })} required />
          </div>
          <div><label className="label">Commission $</label>
            <input type="number" step="0.01" className={f} placeholder="0.00" value={form.commission} onChange={e => setForm({ ...form, commission: e.target.value })} />
          </div>
        </div>
        {pnlPreview !== null && (
          <div className={`rounded-lg px-4 py-3 text-center font-mono font-bold text-lg
            ${pnlPreview >= 0 ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : "bg-red-500/10 text-red-400 border border-red-500/30"}`}>
            {pnlPreview >= 0 ? "▲" : "▼"} {fmt(pnlPreview)}
          </div>
        )}
        <div><label className="label">Setup / Strategy</label>
          <input className={f} placeholder="e.g. Breakout, VWAP bounce, Gap and go…" value={form.setup} onChange={e => setForm({ ...form, setup: e.target.value })} />
        </div>
        <div><label className="label">Notes</label>
          <textarea rows={2} className={f + " resize-none"} placeholder="What happened? Emotions, execution notes…"
            value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-400 text-sm font-semibold hover:bg-gray-700 transition-colors">Cancel</button>
          <button type="submit" className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors">Save Trade</button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Lesson Form ──────────────────────────────────────────────────────────────
function LessonForm({ trades, onSave, onClose }: {
  trades: Trade[]; onSave: (l: Lesson) => void; onClose: () => void;
}) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10), title: "", description: "",
    category: "Psychology" as LessonCategory, severity: "warning" as LessonSeverity, tradeId: "",
  });

  const f = "bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 w-full";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title) return;
    onSave({ id: uuidv4(), date: form.date, title: form.title, description: form.description,
      category: form.category, severity: form.severity, tradeId: form.tradeId || undefined,
      createdAt: new Date().toISOString() });
  };

  return (
    <Modal title="Add Lesson Learned" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Date</label>
            <input type="date" className={f} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          </div>
          <div><label className="label">Linked Trade</label>
            <select className={f} value={form.tradeId} onChange={e => setForm({ ...form, tradeId: e.target.value })}>
              <option value="">None</option>
              {trades.map(t => <option key={t.id} value={t.id}>{t.ticker} — {format(parseISO(t.date), "MMM d")}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Type</label>
          <div className="flex gap-2">
            {(["critical", "warning", "insight"] as LessonSeverity[]).map(s => {
              const cfg = SEVERITY_CONFIG[s];
              return (
                <button key={s} type="button" onClick={() => setForm({ ...form, severity: s })}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border
                    ${form.severity === s ? cfg.bg : "bg-gray-800 border-gray-700 text-gray-500"}`}>
                  <span className={form.severity === s ? cfg.color : ""}>{cfg.icon}</span>
                  <span className={form.severity === s ? cfg.color : ""}>{cfg.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="label">Category</label>
          <div className="flex flex-wrap gap-2">
            {(["Risk Management", "Entry", "Exit", "Psychology", "Setup", "Other"] as LessonCategory[]).map(c => (
              <button key={c} type="button" onClick={() => setForm({ ...form, category: c })}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${form.category === c ? "text-white" : "bg-gray-800 text-gray-500 hover:text-gray-300"}`}
                style={form.category === c ? { background: CATEGORY_COLORS[c] } : {}}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <div><label className="label">Title</label>
          <input className={f} placeholder="e.g. Chased entry after missing the breakout" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
        </div>
        <div><label className="label">Details</label>
          <textarea rows={3} className={f + " resize-none"} placeholder="What happened, what should you do differently…"
            value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-400 text-sm font-semibold hover:bg-gray-700 transition-colors">Cancel</button>
          <button type="submit" className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors">Save Lesson</button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="font-bold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
