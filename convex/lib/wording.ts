// Rider-facing wording (website, SMS, timeline). From docs/03-DATA-MODEL.md and docs/05 section 9.
// Website text keeps accents; SMS text strips them (stripAccents).

import { TIME_ZONE } from "../../shared/config";
import type { RideStatus } from "./stateMachine";

export type Lang = "en" | "es";
export type Bilingual = { en: string; es: string };

const STATUS_WORDING: Record<RideStatus, Bilingual> = {
  collecting: { en: "We are taking your ride request.", es: "Estamos tomando su solicitud de transporte." },
  needs_info: { en: "We need a few more details for your ride.", es: "Necesitamos más detalles para su transporte." },
  requested: { en: "We are arranging your ride.", es: "Estamos organizando su transporte." },
  calling_broker: { en: "We are contacting the ride company.", es: "Estamos llamando a la empresa de transporte." },
  booked: { en: "Your ride is booked. Pickup {{window}}.", es: "Su transporte está reservado. Recogida {{window}}." },
  delayed: {
    en: "Your driver is running late. New estimated pickup {{eta}}.",
    es: "Su conductor se retrasó. Nueva hora estimada de recogida {{eta}}.",
  },
  late: {
    en: "Your driver is late. We are asking for an urgent replacement ride.",
    es: "Su conductor se retrasó. Estamos pidiendo otro transporte urgente.",
  },
  recovery_calling: { en: "We are arranging a replacement ride now.", es: "Estamos organizando otro transporte ahora." },
  replacement_booked: {
    en: "A replacement ride is on the way. Pickup {{window}}.",
    es: "Va en camino otro transporte. Recogida {{window}}.",
  },
  needs_human: {
    en: "We need a person to help with this ride. Please call your health plan.",
    es: "Una persona debe ayudar con este transporte. Llame a su plan de salud.",
  },
  ineligible: {
    en: "We could not book this ride because your paperwork needs renewal.",
    es: "No pudimos reservar este transporte porque sus documentos necesitan renovación.",
  },
  completed: { en: "Trip completed.", es: "Viaje completado." },
  cancelled: { en: "Trip cancelled.", es: "Viaje cancelado." },
};

/** Fields used to fill status wording. Only recorded values, never guesses. */
export type RideTimes = {
  pickupWindowStart?: number;
  pickupWindowEnd?: number;
  estimatedPickupAt?: number;
  replacementWindowStart?: number;
  replacementWindowEnd?: number;
};

function tidy(s: string): string {
  // Intl emits narrow no-break spaces in times; plain spaces read better in SMS.
  return s.replace(/[  ]/g, " ");
}

export function formatTime(ts: number, lang: Lang): string {
  return tidy(
    new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
      timeZone: TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
    }).format(ts),
  );
}

export function formatDay(ts: number, lang: Lang): string {
  return tidy(
    new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
      timeZone: TIME_ZONE,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(ts),
  );
}

export function formatDateTime(ts: number, lang: Lang): string {
  return `${formatDay(ts, lang)}, ${formatTime(ts, lang)}`;
}

/** "Sat, Oct 25, 7:30 AM - 7:45 AM". Returns "" when the window is unknown. */
export function formatWindow(start: number | undefined, end: number | undefined, lang: Lang): string {
  if (start === undefined) return "";
  const day = formatDay(start, lang);
  return end === undefined
    ? `${day}, ${formatTime(start, lang)}`
    : `${day}, ${formatTime(start, lang)} - ${formatTime(end, lang)}`;
}

function fill(template: string, vars: Record<string, string>): string {
  return (
    template
      .replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "")
      // Spanish times end in "a.m."; don't follow them with a second period.
      .replace(/\.\./g, ".")
  );
}

function timeVars(times: RideTimes, lang: Lang, status: RideStatus): Record<string, string> {
  const window =
    status === "replacement_booked"
      ? formatWindow(times.replacementWindowStart, times.replacementWindowEnd, lang)
      : formatWindow(times.pickupWindowStart, times.pickupWindowEnd, lang);
  const eta = times.estimatedPickupAt !== undefined ? formatDateTime(times.estimatedPickupAt, lang) : "";
  return { window, eta };
}

export function statusText(status: RideStatus, lang: Lang, times: RideTimes = {}): string {
  const text = fill(STATUS_WORDING[status][lang], timeVars(times, lang, status));
  // Drop a dangling "Pickup ." when a time is not recorded yet.
  return text.replace(/ (Pickup|Recogida|New estimated pickup|Nueva hora estimada de recogida) \.$/, "");
}

export function statusTextBoth(status: RideStatus, times: RideTimes = {}): Bilingual {
  return { en: statusText(status, "en", times), es: statusText(status, "es", times) };
}

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// ---- SMS templates (docs/05 section 9). The brain picks a template; it never writes facts. ----

export const SMS_TEMPLATES = {
  booked: {
    en: "Your ride to {{destination}} is booked. Pickup {{window}}. Confirmation {{num}}.{{linkText}}",
    es: "Su transporte a {{destination}} esta reservado. Recogida {{window}}. Confirmacion {{num}}.{{linkText}}",
  },
  delay_received: {
    en: "We got your report that your driver is late. We are contacting the ride company now.",
    es: "Recibimos su aviso de que el conductor se retraso. Estamos llamando a la empresa de transporte.",
  },
  delay_update: {
    en: "Your driver is running late. New estimated pickup {{eta}}.{{linkText}}",
    es: "Su conductor se retraso. Nueva hora estimada de recogida {{eta}}.{{linkText}}",
  },
  replacement: {
    en: "Your driver was late. A replacement ride is coming. New pickup {{window}}. Confirmation {{num}}.{{linkText}}",
    es: "Su conductor se retraso. Va en camino otro transporte. Nueva recogida {{window}}. Confirmacion {{num}}.{{linkText}}",
  },
  needs_human: {
    en: "We could not finish arranging your ride. A person will help. Please call your health plan.",
    es: "No pudimos terminar de organizar su transporte. Una persona le ayudara. Llame a su plan de salud.",
  },
  ineligible: {
    en: "We could not book this ride because your ride paperwork needs renewal. Please contact your health plan.",
    es: "No pudimos reservar este transporte porque sus documentos necesitan renovacion. Comuniquese con su plan de salud.",
  },
} as const satisfies Record<string, Bilingual>;

export type SmsTemplate = keyof typeof SMS_TEMPLATES;
export const SMS_TEMPLATE_NAMES = Object.keys(SMS_TEMPLATES) as SmsTemplate[];

export type SmsFacts = {
  destination?: string;
  confirmationNumber?: string;
  replacementConfirmationNumber?: string;
  link?: string;
} & RideTimes;

/**
 * Renders an SMS from recorded fields only. Returns an error instead of text when a
 * template needs a fact that is not recorded, so we never send a message with blanks.
 */
export function renderSms(
  template: SmsTemplate,
  lang: Lang,
  facts: SmsFacts,
): { ok: true; body: string } | { ok: false; missing: string } {
  const linkText = facts.link ? (lang === "es" ? ` Vea sus viajes: ${facts.link}` : ` See your trips: ${facts.link}`) : "";
  let vars: Record<string, string> = { linkText };
  if (template === "booked") {
    if (!facts.confirmationNumber || facts.pickupWindowStart === undefined) return { ok: false, missing: "booking" };
    vars = {
      ...vars,
      destination: facts.destination ?? "",
      window: formatWindow(facts.pickupWindowStart, facts.pickupWindowEnd, lang),
      num: facts.confirmationNumber,
    };
  } else if (template === "delay_update") {
    if (facts.estimatedPickupAt === undefined) return { ok: false, missing: "estimatedPickupAt" };
    vars = { ...vars, eta: formatDateTime(facts.estimatedPickupAt, lang) };
  } else if (template === "replacement") {
    if (!facts.replacementConfirmationNumber || facts.replacementWindowStart === undefined) {
      return { ok: false, missing: "replacement" };
    }
    vars = {
      ...vars,
      window: formatWindow(facts.replacementWindowStart, facts.replacementWindowEnd, lang),
      num: facts.replacementConfirmationNumber,
    };
  }
  return { ok: true, body: stripAccents(fill(SMS_TEMPLATES[template][lang], vars)) };
}
