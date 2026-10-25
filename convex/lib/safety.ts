// Outbound safety. Every outbound call and SMS must pass checkOutbound first.
// Never bypass this, even for testing (CLAUDE.md hard rule 1).

const E164 = /^\+[1-9]\d{6,14}$/;

export function isE164(phone: string): boolean {
  return E164.test(phone);
}

export function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export type OutboundCheck = { ok: true } | { ok: false; reason: string };

/** Allowed only if the number is E.164 and listed in ALLOWED_OUTBOUND_NUMBERS. An empty list allows nothing. */
export function checkOutbound(
  phone: string,
  rawAllowlist: string | undefined = process.env.ALLOWED_OUTBOUND_NUMBERS,
): OutboundCheck {
  if (!isE164(phone)) return { ok: false, reason: `not an E.164 number: ${phone}` };
  if (!parseAllowlist(rawAllowlist).has(phone)) {
    return { ok: false, reason: `${phone} is not in ALLOWED_OUTBOUND_NUMBERS` };
  }
  return { ok: true };
}
