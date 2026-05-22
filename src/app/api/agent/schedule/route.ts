import { NextRequest, NextResponse } from "next/server";
import { saveSchedule, getEnabledSchedules } from "@/lib/agent/memory";

interface ScheduleBody {
  walletAddress?: string;
  enabled:        boolean;
  interval:       string;
  cron?:          string;
  timezone:       string;
}

export async function POST(request: NextRequest) {
  let body: ScheduleBody;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  // Save to MongoDB so schedule persists across server restarts
  if (body.walletAddress) {
    await saveSchedule(body.walletAddress, {
      enabled:  body.enabled,
      interval: body.interval,
      cron:     body.cron ?? "0 * * * *",
      timezone: body.timezone ?? "UTC",
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  const schedules = await getEnabledSchedules();
  return NextResponse.json({ schedules });
}
