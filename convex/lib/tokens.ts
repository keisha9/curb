// Rider website access tokens. The raw token only ever exists in the SMS link;
// the database stores its SHA-256 hash.

export function newRawToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function tokenTtlMs(): number {
  const days = Number(process.env.PORTAL_TOKEN_TTL_DAYS ?? "14");
  return (Number.isFinite(days) && days > 0 ? days : 14) * 86_400_000;
}
