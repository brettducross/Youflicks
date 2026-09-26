import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/server/db";
import { GATEWAY_SPEND_LEDGER_ID } from "@/server/beta/defaults";
import {
  BUDGET_LEDGER_PAGE_SIZE,
  OpsQueryError,
  parseBudgetLedgerCursor,
} from "@/server/sg/ops-window";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = env.BETA_OPS_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }
  let ledgerCursor: string | null;
  try {
    ledgerCursor = parseBudgetLedgerCursor(new URL(request.url).searchParams.get("ledgerCursor"));
  } catch (error) {
    const message = error instanceof OpsQueryError ? error.message : "Invalid ledger cursor.";
    return NextResponse.json({ error: { code: "BAD_REQUEST", message } }, { status: 400 });
  }
  const [row, lanes, budgetLedgerPage] = await Promise.all([
    prisma.gatewaySpendLedger.findUnique({
      where: { id: GATEWAY_SPEND_LEDGER_ID },
    }),
    prisma.gatewaySpendLedger.findMany({
      where: { scopeKind: "LANE" },
      orderBy: { id: "asc" },
    }),
    prisma.aiVideoBudgetLedger.findMany({
      where: ledgerCursor ? { id: { gt: ledgerCursor } } : undefined,
      orderBy: { id: "asc" },
      take: BUDGET_LEDGER_PAGE_SIZE + 1,
    }),
  ]);
  const budgetLedgers = budgetLedgerPage.slice(0, BUDGET_LEDGER_PAGE_SIZE);
  const budgetLedgerNextCursor =
    budgetLedgerPage.length > BUDGET_LEDGER_PAGE_SIZE ? (budgetLedgers[budgetLedgers.length - 1]?.id ?? null) : null;
  return NextResponse.json({
    ledgerId: GATEWAY_SPEND_LEDGER_ID,
    jobsAccepted: row?.jobsAccepted ?? 0,
    spendUsd: row?.spendUsd ?? 0,
    reservedUsd: row?.reservedUsd ?? 0,
    billedSeconds: row?.billedSeconds ?? 0,
    reservedSeconds: row?.reservedSeconds ?? 0,
    scopeKind: row?.scopeKind ?? "GLOBAL",
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    lanes: lanes.map((lane) => ({
      ledgerId: lane.id,
      scopeKind: lane.scopeKind,
      jobsAccepted: lane.jobsAccepted,
      spendUsd: lane.spendUsd,
      reservedUsd: lane.reservedUsd,
      billedSeconds: lane.billedSeconds,
      reservedSeconds: lane.reservedSeconds,
      updatedAt: lane.updatedAt.toISOString(),
    })),
    budgetLedgers: budgetLedgers.map((ledger) => ({
      id: ledger.id,
      scopeKind: ledger.scopeKind,
      projectId: ledger.projectId,
      userId: ledger.userId,
      windowKey: ledger.windowKey,
      reservedSeconds: ledger.reservedSeconds,
      committedSeconds: ledger.committedSeconds,
      reservedUsd: ledger.reservedUsd,
      committedUsd: ledger.committedUsd,
      attempts: ledger.attempts,
      updatedAt: ledger.updatedAt.toISOString(),
    })),
    budgetLedgerNextCursor,
  });
}
