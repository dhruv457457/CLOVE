"use client";

import React, { useState, useEffect } from "react";
import { Clock, Play, Pause, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";
import { metamaskStore } from "@/lib/web3/metamaskStore";

export interface ScheduleConfig {
  enabled:    boolean;
  interval:   "5min" | "15min" | "30min" | "1hour" | "6hour" | "daily" | "weekly" | "custom";
  cron?:      string;   // custom cron expression
  timezone:   string;
  lastRunAt?: number;
  nextRunAt?: number;
  runCount:   number;
}

const INTERVALS = [
  { value: "5min",  label: "Every 5 minutes", cron: "*/5 * * * *"  },
  { value: "15min", label: "Every 15 minutes", cron: "*/15 * * * *" },
  { value: "30min", label: "Every 30 minutes", cron: "*/30 * * * *" },
  { value: "1hour", label: "Every hour",        cron: "0 * * * *"   },
  { value: "6hour", label: "Every 6 hours",     cron: "0 */6 * * *" },
  { value: "daily", label: "Daily at 9:00 AM",  cron: "0 9 * * *"   },
  { value: "weekly",label: "Weekly (Monday)",   cron: "0 9 * * 1"   },
  { value: "custom",label: "Custom cron…",      cron: ""            },
] as const;

function getNextRun(interval: ScheduleConfig["interval"], cron?: string): number {
  const now = Date.now();
  const ms: Record<string, number> = {
    "5min":  5  * 60 * 1000,
    "15min": 15 * 60 * 1000,
    "30min": 30 * 60 * 1000,
    "1hour": 60 * 60 * 1000,
    "6hour": 6  * 60 * 60 * 1000,
    "daily": 24 * 60 * 60 * 1000,
    "weekly":7  * 24 * 60 * 60 * 1000,
  };
  return now + (ms[interval] ?? 60 * 60 * 1000);
}

const DEFAULT_SCHEDULE: ScheduleConfig = {
  enabled:  false,
  interval: "1hour",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  runCount: 0,
};

function loadSchedule(): ScheduleConfig {
  try {
    const raw = localStorage.getItem("clove_schedule");
    return raw ? { ...DEFAULT_SCHEDULE, ...JSON.parse(raw) } : DEFAULT_SCHEDULE;
  } catch { return DEFAULT_SCHEDULE; }
}

function saveSchedule(s: ScheduleConfig) {
  localStorage.setItem("clove_schedule", JSON.stringify(s));
}

interface Props {
  onScheduledRun?: () => void;
}

export default function ScheduleManager({ onScheduledRun }: Props) {
  const [schedule, setSchedule] = useState<ScheduleConfig>(DEFAULT_SCHEDULE);
  const [mounted, setMounted]   = useState(false);
  const [saving,  setSaving]    = useState(false);
  const [saved,   setSaved]     = useState(false);

  useEffect(() => {
    setMounted(true);
    setSchedule(loadSchedule());
  }, []);

  // Poll: check if it's time to run
  useEffect(() => {
    if (!mounted || !schedule.enabled) return;

    const timer = setInterval(() => {
      const now = Date.now();
      if (schedule.nextRunAt && now >= schedule.nextRunAt) {
        // Fire!
        const updated: ScheduleConfig = {
          ...schedule,
          lastRunAt: now,
          nextRunAt: getNextRun(schedule.interval, schedule.cron),
          runCount:  schedule.runCount + 1,
        };
        setSchedule(updated);
        saveSchedule(updated);
        onScheduledRun?.();
      }
    }, 15_000); // check every 15s

    return () => clearInterval(timer);
  }, [mounted, schedule, onScheduledRun]);

  if (!mounted) return null;

  const update = (patch: Partial<ScheduleConfig>) => {
    setSchedule(prev => {
      const next = { ...prev, ...patch };
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    const cronEntry = INTERVALS.find(i => i.value === schedule.interval);
    const next: ScheduleConfig = {
      ...schedule,
      nextRunAt: schedule.enabled ? getNextRun(schedule.interval, schedule.cron) : undefined,
      cron: schedule.interval === "custom" ? schedule.cron : cronEntry?.cron,
    };
    saveSchedule(next);
    setSchedule(next);

    // Register with server + MongoDB (best-effort)
    try {
      const wallet = metamaskStore.getState().userAddress;
      await fetch("/api/agent/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...next, walletAddress: wallet ?? undefined }),
      });
    } catch { /* non-fatal */ }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleToggle = () => {
    const enabled = !schedule.enabled;
    const updated = {
      ...schedule,
      enabled,
      nextRunAt: enabled ? getNextRun(schedule.interval, schedule.cron) : undefined,
    };
    setSchedule(updated);
    saveSchedule(updated);
  };

  const intervalMeta = INTERVALS.find(i => i.value === schedule.interval);

  return (
    <div className="flex flex-col gap-3 p-4">

      {/* Status banner */}
      <div className={`flex items-center justify-between p-3 rounded-lg border ${
        schedule.enabled
          ? "border-[rgba(21,133,105,0.3)] bg-[rgba(21,133,105,0.06)]"
          : "border-[rgba(255,255,255,0.07)] bg-[rgba(0,0,0,0.3)]"
      }`}>
        <div className="flex items-center gap-2">
          {schedule.enabled
            ? <CheckCircle size={12} className="text-[#1aad89]" />
            : <AlertCircle size={12} className="text-[#3d6655]" />
          }
          <span className={`text-[10px] font-bold font-mono ${schedule.enabled ? "text-[#1aad89]" : "text-[#3d6655]"}`}>
            {schedule.enabled ? "SCHEDULED" : "NOT SCHEDULED"}
          </span>
        </div>
        <button
          onClick={handleToggle}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold font-mono transition-all ${
            schedule.enabled
              ? "bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/15"
              : "bg-[#158569] text-white hover:bg-[#1aad89]"
          }`}
        >
          {schedule.enabled
            ? <><Pause size={9} /> Disable</>
            : <><Play  size={9} /> Enable</>
          }
        </button>
      </div>

      {/* Interval picker */}
      <div className="space-y-1.5">
        <label className="block text-[8px] uppercase font-mono text-[#3d6655] tracking-wider">
          Run Frequency
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {INTERVALS.filter(i => i.value !== "custom").map(opt => (
            <button
              key={opt.value}
              onClick={() => update({ interval: opt.value as ScheduleConfig["interval"] })}
              className={`py-1.5 px-2 rounded-lg text-[9px] font-mono text-left transition-all border ${
                schedule.interval === opt.value
                  ? "bg-[rgba(21,133,105,0.15)] border-[rgba(21,133,105,0.4)] text-[#1aad89]"
                  : "border-[rgba(255,255,255,0.06)] text-[#3d6655] hover:text-[#7aad97] hover:border-[rgba(255,255,255,0.1)]"
              }`}
            >
              {opt.label}
            </button>
          ))}
          <button
            onClick={() => update({ interval: "custom" })}
            className={`py-1.5 px-2 rounded-lg text-[9px] font-mono text-left transition-all border col-span-2 ${
              schedule.interval === "custom"
                ? "bg-[rgba(21,133,105,0.15)] border-[rgba(21,133,105,0.4)] text-[#1aad89]"
                : "border-[rgba(255,255,255,0.06)] text-[#3d6655] hover:text-[#7aad97]"
            }`}
          >
            Custom cron expression
          </button>
        </div>

        {/* Custom cron input */}
        {schedule.interval === "custom" && (
          <input
            type="text"
            value={schedule.cron ?? ""}
            onChange={e => update({ cron: e.target.value })}
            placeholder="0 */6 * * *"
            className="w-full px-2 py-1.5 rounded border border-[rgba(21,133,105,0.2)] bg-[rgba(0,0,0,0.5)] text-[10px] font-mono text-[#c4c4e8] focus:outline-none focus:border-[rgba(21,133,105,0.5)]"
          />
        )}
      </div>

      {/* Cron expression display */}
      {schedule.interval !== "custom" && intervalMeta?.cron && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded border border-[rgba(21,133,105,0.1)] bg-[rgba(0,0,0,0.3)]">
          <Clock size={9} className="text-[#3d6655]" />
          <span className="font-mono text-[9px] text-[#3d6655]">cron:</span>
          <span className="font-mono text-[9px] text-[#7aad97]">{intervalMeta.cron}</span>
        </div>
      )}

      {/* Timezone */}
      <div className="space-y-1">
        <label className="block text-[8px] uppercase font-mono text-[#3d6655] tracking-wider">Timezone</label>
        <div className="px-2 py-1.5 rounded border border-[rgba(21,133,105,0.1)] bg-[rgba(0,0,0,0.3)]">
          <span className="font-mono text-[9px] text-[#7aad97]">{schedule.timezone}</span>
        </div>
      </div>

      {/* Stats */}
      {(schedule.lastRunAt || schedule.nextRunAt) && (
        <div className="grid grid-cols-2 gap-2">
          {schedule.lastRunAt && (
            <div className="p-2 rounded bg-[rgba(0,0,0,0.4)] border border-[rgba(21,133,105,0.1)]">
              <span className="block text-[7px] uppercase font-mono text-[#3d6655] mb-0.5">Last Run</span>
              <span className="block text-[8px] font-mono text-[#7aad97]">
                {new Date(schedule.lastRunAt).toLocaleTimeString()}
              </span>
            </div>
          )}
          {schedule.nextRunAt && schedule.enabled && (
            <div className="p-2 rounded bg-[rgba(0,0,0,0.4)] border border-[rgba(21,133,105,0.1)]">
              <span className="block text-[7px] uppercase font-mono text-[#3d6655] mb-0.5">Next Run</span>
              <span className="block text-[8px] font-mono text-[#7aad97]">
                {new Date(schedule.nextRunAt).toLocaleTimeString()}
              </span>
            </div>
          )}
          <div className="p-2 rounded bg-[rgba(0,0,0,0.4)] border border-[rgba(21,133,105,0.1)]">
            <span className="block text-[7px] uppercase font-mono text-[#3d6655] mb-0.5">Total Runs</span>
            <span className="block text-[10px] font-bold font-mono text-[#edfaf5]">{schedule.runCount}</span>
          </div>
        </div>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-[rgba(21,133,105,0.12)] border border-[rgba(21,133,105,0.3)] text-[10px] font-bold font-mono text-[#1aad89] hover:bg-[rgba(21,133,105,0.2)] disabled:opacity-50 transition-all"
      >
        {saving
          ? <><RefreshCw size={10} className="animate-spin" /> Saving…</>
          : saved
          ? <><CheckCircle size={10} /> Saved!</>
          : "Save Schedule"
        }
      </button>
    </div>
  );
}
