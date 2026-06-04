"use client";

import { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { format, parseISO, startOfWeek, startOfMonth, startOfYear } from "date-fns";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, Plus, X, BookOpen, Target,
  AlertTriangle, Lightbulb, ChevronDown, ChevronUp,
  Activity, DollarSign, BarChart2, Award, Trash2, Edit3,
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

// ─── Seed trades ─────────────────────────────────────────────────────────────
const SEED_TRADES: Trade[] = [
  {
    id: "seed-1",
    date: "2026-06-04",
    ticker: "BB",
    direction: "LONG",
    entryPrice: 9.95,
    exitPrice: 10.076,
    shares: 3000,
    commission: 1.21,
    status: "CLOSED",
    setup: "Momentum",
    notes: "Bought 3000 shares, sold into strength",
    createdAt: "2026-06-04T10:00:00Z",
  },
  {
    id: "seed-2",
    date: "2026-06-04",
    ticker: "BB",
    direction: "LONG",
    entryPrice: 9.01,
    exitPrice: 9.64,
    shares: 2500,
    commission: 0.99,
    status: "CLOSED",
    setup: "Pullback re-entry",
    notes: "Second BB trade on same day, bought dip",
    createdAt: "2026-06-04T11:00:00Z",
  },
  {
    id: "seed-3",
    date: "2026-06-02",
    ticker: "HPE",
    direction: "SHORT",
    entryPrice: 59.9205,
    exitPrice: 56.0925,
    shares: 300,
    commission: 0.43,
    status: "CLOSED",
    setup: "Short sell — covered at blended avg",
    notes: "Sold short 300 @ 59.9205, covered: 150 @ 55.605 + 150 @ 56.58 (blended exit $56.0925)",
    createdAt: "2026-06-02T10:00:00Z",
  },
];

const SEVERITY_CONFIG: Record<LessonSeverity, { color: string; bg: string; icon: JSX.Element; label: string }> = {
  critical: { color: "text-red-400", bg: "bg-red-400/10 border-red-400/30", icon: <AlertTriangle size={14} />, label: "Mistake" },
  warning: { color: "text-yellow-400", bg: "bg-yellow-400/10 border-yellow-400/30", icon: <Target size={14} />, label: "Watch Out" },
  insight: { color: "text-indigo-400", bg: "bg-indigo-400/10 border-indigo-400/30", icon: <Lightbulb size={14} />, label: "Insight" },
};

const CATEGORY_COLORS: Record<LessonCategory, string> = {
  "Risk Management": "#6366f1",
  "Entry": "#06b6d4",
  "Exit": "#10b981",
  "Psychology": "#f59e0b",
  "Setup": "#8b5cf6",
  "Other": "#6b7280",
};

// ─── Period P&L Strip ────────────────────────────────────────────────────────
function PeriodStrip({ periods }: {
  periods: { label: string; pnl: number; count: number; winRate: number | null }[];
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="px-5 pt-4 pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500">P&amp;L by Period</h3>
      </div>
      <div className="grid grid-cols-5 divide-x divide-gray-800">
        {periods.map((p, i) => {
          const isPos = p.pnl >= 0;
          const isEmpty = p.count === 0;
          return (
            <div key={p.label} className={`px-4 py-4 flex flex-col gap-1 ${i === 0 ? "bg-gray-800/40" : ""}`}>
              <span className="text-[10px] font-semibold tracking-widest uppercase text-gray-500">{p.label}</span>
              <span className={`text-lg font-bold font-mono leading-tight ${isEmpty ? "text-gray-600" : isPos ? "text-emerald-400" : "text-red-400"}`}>
                {isEmpty ? "—" : fmt(p.pnl)}
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-600">
                  {p.count === 0 ? "No trades" : `${p.count} trade${p.count !== 1 ? "s" : ""}`}
                </span>
                {p.winRate !== null && p.count > 0 && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${p.winRate >= 50 ? "bg-emerald-400/10 text-emerald-400" : "bg-red-400/10 text-red-400"}`}>
                    {p.winRate.toFixed(0)}%W
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, icon, positive, neutral,
}: {
  label: string; value: string; sub?: string;
  icon: React.ReactNode; positive?: boolean; neutral?: boolean;
}) {
  const color = neutral ? "text-gray-300" : positive ? "text-emerald-400" : "text-red-400";
  const glow = neutral ? "" : positive ? "glow-green" : "glow-red";
  return (
    <div className={`rounded-xl p-5 border border-gray-800 bg-gray-900 ${glow}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold tracking-widest uppercase text-gray-500">{label}</span>
        <span className="text-gray-600">{icon}</span>
      </div>
      <div className={`text-2xl font-bold font-mono ${color} animate-count`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

// ─── Trade Row ───────────────────────────────────────────────────────────────
function TradeRow({ trade, onDelete }: { trade: Trade; onDelete: (id: string) => void }) {
  const pnl = tradePnl(trade);
  const isPos = pnl >= 0;
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
      <span className="font-mono text-gray-300">{trade.exitPrice ? `$${trade.exitPrice.toFixed(2)}` : <span className="text-yellow-400 text-xs">OPEN</span>}</span>
      <span className="font-mono text-gray-400">{trade.shares.toLocaleString()}</span>
      <div>
        {trade.exitPrice ? (
          <span className={`font-mono font-bold ${isPos ? "text-emerald-400" : "text-red-400"}`}>
            {fmt(pnl)} {pnlPct !== null && <span className="text-xs opacity-70">({pct(pnlPct)})</span>}
            {trade.commission > 0 && <span className="text-gray-600 text-xs ml-1">-${trade.commission.toFixed(2)} comm</span>}
          </span>
        ) : <span className="text-yellow-400 text-xs font-semibold">OPEN</span>}
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
  const [trades, setTrades] = useState<Trade[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [tab, setTab] = useState<"trades" | "lessons" | "analytics">("trades");
  const [showTradeForm, setShowTradeForm] = useState(false);
  const [showLessonForm, setShowLessonForm] = useState(false);
  const [filterDate, setFilterDate] = useState("");
  const [lessonFilter, setLessonFilter] = useState<LessonSeverity | "all">("all");

  useEffect(() => {
    const t = localStorage.getItem("trades");
    const l = localStorage.getItem("lessons");
    if (t) {
      setTrades(JSON.parse(t));
    } else {
      setTrades(SEED_TRADES);
      localStorage.setItem("trades", JSON.stringify(SEED_TRADES));
    }
    if (l) setLessons(JSON.parse(l));
  }, []);

  const saveTrades = useCallback((t: Trade[]) => { setTrades(t); localStorage.setItem("trades", JSON.stringify(t)); }, []);
  const saveLessons = useCallback((l: Lesson[]) => { setLessons(l); localStorage.setItem("lessons", JSON.stringify(l)); }, []);

  // ─── Computed stats ──────────────────────────────────────────────────────
  const closedTrades = trades.filter(t => t.status === "CLOSED");
  const allPnl = closedTrades.reduce((s, t) => s + tradePnl(t), 0);
  const wins = closedTrades.filter(t => tradePnl(t) > 0);
  const losses = closedTrades.filter(t => tradePnl(t) < 0);
  const winRate = closedTrades.length ? (wins.length / closedTrades.length) * 100 : 0;
  const avgWin = wins.length ? wins.reduce((s, t) => s + tradePnl(t), 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + tradePnl(t), 0) / losses.length : 0;
  const profitFactor = Math.abs(avgLoss) > 0 ? avgWin / Math.abs(avgLoss) : 0;

  const today = new Date().toISOString().slice(0, 10);
  const todayTrades = trades.filter(t => t.date === today && t.status === "CLOSED");
  const dailyPnl = todayTrades.reduce((s, t) => s + tradePnl(t), 0);

  // ─── Period P&L ──────────────────────────────────────────────────────────
  const now = new Date();
  const weekStartStr = startOfWeek(now, { weekStartsOn: 1 }).toISOString().slice(0, 10);
  const monthStartStr = startOfMonth(now).toISOString().slice(0, 10);
  const yearStartStr = startOfYear(now).toISOString().slice(0, 10);

  function periodStats(startStr: string, endStr: string = today) {
    const ts = closedTrades.filter(t => t.date >= startStr && t.date <= endStr);
    const pnl = ts.reduce((s, t) => s + tradePnl(t), 0);
    const w = ts.filter(t => tradePnl(t) > 0).length;
    return { pnl, count: ts.length, winRate: ts.length > 0 ? (w / ts.length) * 100 : null };
  }

  const periods = [
    { label: "Today", ...periodStats(today) },
    { label: "This Week", ...periodStats(weekStartStr) },
    { label: "This Month", ...periodStats(monthStartStr) },
    { label: "YTD", ...periodStats(yearStartStr) },
    { label: "All Time", ...periodStats("2000-01-01") },
  ];

  // ─── Charts data ─────────────────────────────────────────────────────────
  const equityCurve = (() => {
    const sorted = [...closedTrades].sort((a, b) => a.date.localeCompare(b.date));
    let cum = 0;
    return sorted.map(t => ({ date: format(parseISO(t.date), "MM/dd"), pnl: tradePnl(t), cum: (cum += tradePnl(t)) }));
  })();

  const dailyMap: Record<string, number> = {};
  closedTrades.forEach(t => { dailyMap[t.date] = (dailyMap[t.date] || 0) + tradePnl(t); });
  const dailyBars = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, pnl]) => ({ date: format(parseISO(date), "MM/dd"), pnl }));

  const catCount: Partial<Record<LessonCategory, number>> = {};
  lessons.forEach(l => { catCount[l.category] = (catCount[l.category] || 0) + 1; });

  const displayTrades = filterDate
    ? trades.filter(t => t.date === filterDate)
    : [...trades].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);

  const displayLessons = lessonFilter === "all"
    ? lessons
    : lessons.filter(l => l.severity === lessonFilter);

  return (
    <div className="min-h-screen bg-[#0a0e1a]">
      {/* Header */}
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
        {/* Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Today's P&L"
            value={fmt(dailyPnl)}
            sub={`${todayTrades.length} trade${todayTrades.length !== 1 ? "s" : ""} today`}
            icon={<DollarSign size={16} />}
            positive={dailyPnl >= 0}
            neutral={dailyPnl === 0 && todayTrades.length === 0}
          />
          <StatCard
            label="Overall P&L"
            value={fmt(allPnl)}
            sub={`${closedTrades.length} closed trades`}
            icon={<TrendingUp size={16} />}
            positive={allPnl >= 0}
            neutral={allPnl === 0 && closedTrades.length === 0}
          />
          <StatCard
            label="Win Rate"
            value={`${winRate.toFixed(1)}%`}
            sub={`${wins.length}W / ${losses.length}L`}
            icon={<Award size={16} />}
            positive={winRate >= 50}
            neutral={closedTrades.length === 0}
          />
          <StatCard
            label="Profit Factor"
            value={profitFactor > 0 ? profitFactor.toFixed(2) : "—"}
            sub={`Avg W: ${avgWin > 0 ? fmt(avgWin) : "—"}`}
            icon={<BarChart2 size={16} />}
            positive={profitFactor >= 1}
            neutral={profitFactor === 0}
          />
        </div>

        {/* Period P&L Strip */}
        <PeriodStrip periods={periods} />

        {/* Equity Curve */}
        {equityCurve.length > 1 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Equity Curve</h3>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={equityCurve}>
                <defs>
                  <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={allPnl >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={allPnl >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, color: "#f9fafb", fontSize: 12 }}
                  formatter={(v: number) => [fmt(v), "Cumulative P&L"]}
                />
                <Area type="monotone" dataKey="cum" stroke={allPnl >= 0 ? "#10b981" : "#ef4444"} strokeWidth={2} fill="url(#pnlGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-800">
          {(["trades", "analytics", "lessons"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-semibold capitalize transition-colors border-b-2 -mb-px ${tab === t ? "border-indigo-500 text-white" : "border-transparent text-gray-500 hover:text-gray-300"}`}>
              {t === "lessons" ? "Lessons Learned" : t.charAt(0).toUpperCase() + t.slice(1)}
              {t === "trades" && trades.length > 0 && <span className="ml-2 text-xs bg-gray-800 px-1.5 py-0.5 rounded-full text-gray-400">{trades.length}</span>}
              {t === "lessons" && lessons.length > 0 && <span className="ml-2 text-xs bg-gray-800 px-1.5 py-0.5 rounded-full text-gray-400">{lessons.length}</span>}
            </button>
          ))}
        </div>

        {/* ── Trades Tab ── */}
        {tab === "trades" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
                className="bg-gray-900 border border-gray-700 text-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500" />
              {filterDate && (
                <button onClick={() => setFilterDate("")} className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
                  <X size={12} /> Clear filter
                </button>
              )}
              {filterDate && (
                <span className="text-xs text-gray-500">
                  Day P&L: <span className={`font-mono font-bold ${displayTrades.filter(t => t.status === "CLOSED").reduce((s, t) => s + tradePnl(t), 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {fmt(displayTrades.filter(t => t.status === "CLOSED").reduce((s, t) => s + tradePnl(t), 0))}
                  </span>
                </span>
              )}
            </div>

            {displayTrades.length === 0 ? (
              <div className="text-center py-16 text-gray-600">
                <Activity size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm">No trades yet. Click <strong className="text-gray-400">Log Trade</strong> to get started.</p>
              </div>
            ) : (
              <>
                <div className="hidden md:grid grid-cols-[80px_90px_70px_90px_90px_80px_1fr_36px] gap-2 px-4 py-2 text-xs font-semibold tracking-widest uppercase text-gray-600">
                  <span>Date</span><span>Ticker</span><span>Dir</span>
                  <span>Entry</span><span>Exit</span><span>Shares</span>
                  <span>P&L</span><span />
                </div>
                <div className="space-y-2">
                  {displayTrades.map(t => (
                    <TradeRow key={t.id} trade={t} onDelete={id => saveTrades(trades.filter(x => x.id !== id))} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Analytics Tab ── */}
        {tab === "analytics" && (
          <div className="space-y-6">
            {closedTrades.length === 0 ? (
              <div className="text-center py-16 text-gray-600">
                <BarChart2 size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm">No closed trades to analyze yet.</p>
              </div>
            ) : (
              <>
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Daily P&L</h3>
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
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">P&L per Trade</h3>
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {[...closedTrades].sort((a, b) => tradePnl(b) - tradePnl(a)).map(t => {
                        const p = tradePnl(t);
                        const maxAbs = Math.max(...closedTrades.map(x => Math.abs(tradePnl(x))));
                        const barW = maxAbs > 0 ? Math.abs(p) / maxAbs * 100 : 0;
                        return (
                          <div key={t.id} className="flex items-center gap-2 text-xs">
                            <span className="w-16 text-gray-400 font-mono">{t.ticker}</span>
                            <div className="flex-1 relative h-5 flex items-center">
                              <div className={`h-4 rounded ${p >= 0 ? "bg-emerald-500/30" : "bg-red-500/30"} absolute`}
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
                    { label: "Best Trade", value: fmt(Math.max(...closedTrades.map(tradePnl))), pos: true },
                    { label: "Worst Trade", value: fmt(Math.min(...closedTrades.map(tradePnl))), pos: false },
                    { label: "Avg Win", value: avgWin > 0 ? fmt(avgWin) : "—", pos: true },
                    { label: "Avg Loss", value: avgLoss < 0 ? fmt(avgLoss) : "—", pos: false },
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
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${lessonFilter === f ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-300"}`}>
                    {f === "all" ? "All" : SEVERITY_CONFIG[f].label}
                    {f !== "all" && <span className="ml-1.5 opacity-60">{lessons.filter(l => l.severity === f).length}</span>}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-2">
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
  trades: Trade[];
  onSave: (t: Trade) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    ticker: "",
    direction: "LONG" as "LONG" | "SHORT",
    entryPrice: "",
    exitPrice: "",
    shares: "",
    commission: "",
    notes: "",
    setup: "",
    status: "CLOSED" as "OPEN" | "CLOSED",
  });

  const pnlPreview = (() => {
    const en = parseFloat(form.entryPrice);
    const ex = parseFloat(form.exitPrice);
    const sh = parseFloat(form.shares);
    const cm = parseFloat(form.commission) || 0;
    if (!en || !ex || !sh) return null;
    const raw = (ex - en) * sh;
    const gross = form.direction === "SHORT" ? -raw : raw;
    return gross - cm;
  })();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.ticker || !form.entryPrice || !form.shares) return;
    onSave({
      id: uuidv4(),
      date: form.date,
      ticker: form.ticker.toUpperCase(),
      direction: form.direction,
      entryPrice: parseFloat(form.entryPrice),
      exitPrice: form.exitPrice ? parseFloat(form.exitPrice) : null,
      shares: parseFloat(form.shares),
      commission: parseFloat(form.commission) || 0,
      status: form.exitPrice ? "CLOSED" : "OPEN",
      notes: form.notes,
      setup: form.setup,
      createdAt: new Date().toISOString(),
    });
  };

  const field = "bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 w-full";

  return (
    <Modal title="Log Trade" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Date</label>
            <input type="date" className={field} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
          </div>
          <div>
            <label className="label">Ticker</label>
            <input className={field} placeholder="AAPL" value={form.ticker} onChange={e => setForm({ ...form, ticker: e.target.value })} required />
          </div>
        </div>

        <div>
          <label className="label">Direction</label>
          <div className="flex gap-2">
            {(["LONG", "SHORT"] as const).map(d => (
              <button key={d} type="button" onClick={() => setForm({ ...form, direction: d })}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${form.direction === d ? (d === "LONG" ? "bg-emerald-500/20 border border-emerald-500 text-emerald-400" : "bg-red-500/20 border border-red-500 text-red-400") : "bg-gray-800 border border-gray-700 text-gray-500"}`}>
                {d === "LONG" ? "▲ LONG" : "▼ SHORT"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Entry $</label>
            <input type="number" step="0.0001" className={field} placeholder="0.00" value={form.entryPrice} onChange={e => setForm({ ...form, entryPrice: e.target.value })} required />
          </div>
          <div>
            <label className="label">Exit $</label>
            <input type="number" step="0.0001" className={field} placeholder="0.00" value={form.exitPrice} onChange={e => setForm({ ...form, exitPrice: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Shares / Qty</label>
            <input type="number" step="1" className={field} placeholder="100" value={form.shares} onChange={e => setForm({ ...form, shares: e.target.value })} required />
          </div>
          <div>
            <label className="label">Commission $</label>
            <input type="number" step="0.01" className={field} placeholder="0.00" value={form.commission} onChange={e => setForm({ ...form, commission: e.target.value })} />
          </div>
        </div>

        {pnlPreview !== null && (
          <div className={`rounded-lg px-4 py-3 text-center font-mono font-bold text-lg ${pnlPreview >= 0 ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : "bg-red-500/10 text-red-400 border border-red-500/30"}`}>
            {pnlPreview >= 0 ? "▲" : "▼"} {fmt(pnlPreview)}
          </div>
        )}

        <div>
          <label className="label">Setup / Strategy</label>
          <input className={field} placeholder="e.g. Breakout, VWAP bounce, Gap and go…" value={form.setup} onChange={e => setForm({ ...form, setup: e.target.value })} />
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea rows={2} className={field + " resize-none"} placeholder="What happened? Emotions, execution notes…"
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
  trades: Trade[];
  onSave: (l: Lesson) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    title: "",
    description: "",
    category: "Psychology" as LessonCategory,
    severity: "warning" as LessonSeverity,
    tradeId: "",
  });

  const field = "bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 w-full";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title) return;
    onSave({
      id: uuidv4(),
      date: form.date,
      title: form.title,
      description: form.description,
      category: form.category,
      severity: form.severity,
      tradeId: form.tradeId || undefined,
      createdAt: new Date().toISOString(),
    });
  };

  const categories: LessonCategory[] = ["Risk Management", "Entry", "Exit", "Psychology", "Setup", "Other"];

  return (
    <Modal title="Add Lesson Learned" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Date</label>
            <input type="date" className={field} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label className="label">Linked Trade</label>
            <select className={field} value={form.tradeId} onChange={e => setForm({ ...form, tradeId: e.target.value })}>
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
                  className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border ${form.severity === s ? cfg.bg : "bg-gray-800 border-gray-700 text-gray-500"}`}>
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
            {categories.map(c => (
              <button key={c} type="button" onClick={() => setForm({ ...form, category: c })}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${form.category === c ? "text-white" : "bg-gray-800 text-gray-500 hover:text-gray-300"}`}
                style={form.category === c ? { background: CATEGORY_COLORS[c] } : {}}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Title</label>
          <input className={field} placeholder="e.g. Chased entry after missing the breakout" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
        </div>

        <div>
          <label className="label">Details</label>
          <textarea rows={3} className={field + " resize-none"} placeholder="What happened, what should you do differently…"
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
