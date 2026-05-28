import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/mongodb";

const COLL = "user_permissions";

interface StoredPermission {
  walletAddress:     string;
  permissionsContext: string;
  delegationManager: string;
  grantedTo:         string;
  budgetUsdc:        string;
  periodDays:        number;
  expiresAt:         number;
  delegationId?:     string;
  updatedAt:         Date;
}

/** GET /api/permission?wallet=0x… → { permission } | { permission: null } */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ permission: null });

  const db = await getDb();
  if (!db) return NextResponse.json({ permission: null });

  const doc = await db
    .collection<StoredPermission>(COLL)
    .findOne({ walletAddress: wallet.toLowerCase() });

  if (!doc) return NextResponse.json({ permission: null });

  // Strip MongoDB internal _id before returning
  const { _id, ...perm } = doc as StoredPermission & { _id: unknown };
  void _id;
  return NextResponse.json({ permission: perm });
}

/** POST /api/permission  { walletAddress, permission } → upsert */
export async function POST(req: NextRequest) {
  let body: { walletAddress: string; permission: Omit<StoredPermission, "walletAddress" | "updatedAt"> };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const { walletAddress, permission } = body;
  if (!walletAddress || !permission?.permissionsContext) {
    return NextResponse.json({ error: "walletAddress + permission required" }, { status: 400 });
  }

  const db = await getDb();
  if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

  const doc: StoredPermission = {
    ...permission,
    walletAddress: walletAddress.toLowerCase(),
    updatedAt: new Date(),
  };

  await db.collection<StoredPermission>(COLL).updateOne(
    { walletAddress: walletAddress.toLowerCase() },
    { $set: doc },
    { upsert: true }
  );

  return NextResponse.json({ ok: true });
}

/** DELETE /api/permission?wallet=0x… → remove */
export async function DELETE(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ ok: true });

  const db = await getDb();
  if (!db) return NextResponse.json({ ok: true });

  await db
    .collection(COLL)
    .deleteOne({ walletAddress: wallet.toLowerCase() });

  return NextResponse.json({ ok: true });
}
