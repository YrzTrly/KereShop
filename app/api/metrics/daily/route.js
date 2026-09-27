import { NextResponse } from 'next/server';
import { requireShop } from '@/lib/shop-context.js';
import { getDailyMetrics } from '@/lib/daily-metrics.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/metrics/daily?days=14 — per-day sales totals (revenue, order and
 * item counts) for the shop. Used by the dashboard's daily sales chart.
 */
export async function GET(req) {
  const shop = await requireShop();
  const url = new URL(req.url);
  const raw = Number(url.searchParams.get('days') || 14);
  const days = Math.min(Math.max(Number.isFinite(raw) ? raw : 14, 1), 90);
  const data = await getDailyMetrics(shop._id, days);
  return NextResponse.json({ days, data });
}