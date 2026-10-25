// Parse times spoken to the voice agents. Strings without an offset are read as local
// time in TIME_ZONE, since the assistants talk in the rider's local time.

import { TIME_ZONE } from "../../shared/config";

/** Offset of `timeZone` from UTC at instant `ts`, in ms (e.g. -7h for PDT). */
function zoneOffsetMs(ts: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(ts);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(ts / 1000) * 1000;
}

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

/** Returns ms since epoch, or null if the string is not a usable date-time. */
export function parseLocalIso(input: string, timeZone: string = TIME_ZONE): number | null {
  const s = input.trim();
  if (HAS_OFFSET.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m;
  const naiveUtc = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, sec ? +sec : 0);
  // Two passes handle instants near a DST change.
  let t = naiveUtc - zoneOffsetMs(naiveUtc, timeZone);
  t = naiveUtc - zoneOffsetMs(t, timeZone);
  return t;
}
