// Ops-only functions (dashboard queries and demo controls) require OPS_KEY. The repo and
// the Convex URL are public, and these expose real demo phone numbers and transcripts and
// can place real calls. The rider trips site uses its own per-rider token instead.

import { v } from "convex/values";

export const vOpsKey = v.string();

export function assertOps(opsKey: string): void {
  const expected = process.env.OPS_KEY;
  if (!expected || opsKey !== expected) throw new Error("Ops key missing or wrong (set VITE_OPS_KEY to match OPS_KEY).");
}
