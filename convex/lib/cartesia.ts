// Minimal Cartesia API client (server-side only; the key never leaves Convex).
// Docs: https://docs.cartesia.ai/llms.txt. Every request sends Cartesia-Version.

export const CARTESIA_VERSION = "2026-08-14";
const BASE = "https://api.cartesia.ai";

export function cartesiaConfigured(): boolean {
  return !!process.env.CARTESIA_API_KEY;
}

export type CartesiaResponse = { status: number; ok: boolean; body: unknown };

export async function cartesia(method: string, path: string, body?: unknown): Promise<CartesiaResponse> {
  const key = process.env.CARTESIA_API_KEY;
  if (!key) throw new Error("CARTESIA_API_KEY is not set");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Cartesia-Version": CARTESIA_VERSION,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // keep text
  }
  return { status: res.status, ok: res.ok, body: parsed };
}
