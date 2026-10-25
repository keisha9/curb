// Rider trips website (/trips): opened from the QR code (or, later, an SMS link).
// Token-scoped: every query passes the token, and the server returns only this rider's
// trips with plain-language wording. No transcripts, no decision log (CLAUDE.md rule 9).

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { APP_NAME, TIME_ZONE } from "../../shared/config";

type Lang = "en" | "es";

const T = {
  hi: { en: "Hi", es: "Hola" },
  current: { en: "Current trip", es: "Viaje actual" },
  upcoming: { en: "Upcoming", es: "Próximos" },
  past: { en: "Past trips", es: "Viajes anteriores" },
  none: { en: "No trips here.", es: "No hay viajes." },
  pickup: { en: "Pickup", es: "Recogida" },
  eta: { en: "Estimated pickup", es: "Hora estimada de recogida" },
  confirmation: { en: "Confirmation", es: "Confirmación" },
  replacement: { en: "Replacement ride", es: "Transporte de reemplazo" },
  late: { en: "My driver is late", es: "Mi conductor está tarde" },
  howLate: { en: "About how late?", es: "¿Más o menos cuánto tarde?" },
  notSure: { en: "Not sure", es: "No sé" },
  minutes: { en: "min", es: "min" },
  cancel: { en: "Cancel", es: "Cancelar" },
  sent: { en: "Thanks. We got your report.", es: "Gracias. Recibimos su aviso." },
  back: { en: "Back to my trips", es: "Volver a mis viajes" },
  history: { en: "What happened", es: "Lo que pasó" },
  details: { en: "Details", es: "Detalles" },
  badLink: {
    en: "This link is not valid or has expired. Please ask for a new one.",
    es: "Este enlace no es válido o ya venció. Pida uno nuevo, por favor.",
  },
  paperwork: {
    en: (d: number) => `Your ride paperwork expires in ${d} days. Please contact your health plan to renew it.`,
    es: (d: number) => `Sus documentos de transporte vencen en ${d} días. Comuníquese con su plan de salud para renovarlos.`,
  },
} as const;

const fmt = (ts: number | null, lang: Lang, opts: Intl.DateTimeFormatOptions) =>
  ts == null ? "" : new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { timeZone: TIME_ZONE, ...opts }).format(ts);
const day = (ts: number | null, lang: Lang) => fmt(ts, lang, { weekday: "long", month: "long", day: "numeric" });
const time = (ts: number | null, lang: Lang) => fmt(ts, lang, { hour: "numeric", minute: "2-digit" });
const window_ = (a: number | null, b: number | null, lang: Lang) => (a == null ? "" : `${day(a, lang)}, ${time(a, lang)}${b ? ` – ${time(b, lang)}` : ""}`);

const TOKEN_KEY = "tripsToken";

/** Reads ?t= once, keeps it in sessionStorage, and removes it from the address bar. */
function useToken(): string | null {
  const [token] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("t");
    try {
      if (fromUrl) sessionStorage.setItem(TOKEN_KEY, fromUrl);
      return fromUrl ?? sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return fromUrl;
    }
  });
  useEffect(() => {
    if (window.location.search.includes("t=")) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  return token;
}

type Trip = NonNullable<FunctionReturnType<typeof api.portal.trips>>["current"][number];

export function TripsSite() {
  const token = useToken();
  const me = useQuery(api.portal.me, token ? { token } : "skip");
  const trips = useQuery(api.portal.trips, token ? { token } : "skip");
  const [openTrip, setOpenTrip] = useState<Id<"rides"> | null>(null);

  const lang: Lang = me?.language ?? "en";
  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-xl px-5 py-6 text-xl leading-relaxed">{body}</div>
    </div>
  );

  if (!token || me === null || trips === null) return shell(<p className="mt-10 text-center">{T.badLink[lang]}</p>);
  if (me === undefined || trips === undefined) return shell(<p className="mt-10 text-center text-slate-500">…</p>);

  if (openTrip) return shell(<TripDetail token={token} rideId={openTrip} lang={lang} onBack={() => setOpenTrip(null)} />);

  return shell(
    <>
      <div className="mb-1 text-base font-semibold text-slate-500">{APP_NAME}</div>
      <h1 className="mb-5 text-3xl font-bold">
        {T.hi[lang]}, {me.firstName}
      </h1>

      {me.paperworkNotice && <div className="mb-5 rounded-xl bg-amber-100 p-4 text-amber-950">{T.paperwork[lang](me.paperworkNotice.daysLeft)}</div>}

      {trips.current.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-slate-500">{T.current[lang]}</h2>
          {trips.current.map((t) => (
            <CurrentTrip key={t.id} trip={t} token={token} lang={lang} onOpen={() => setOpenTrip(t.id)} />
          ))}
        </section>
      )}

      <TripList title={T.upcoming[lang]} trips={trips.upcoming} lang={lang} onOpen={setOpenTrip} />
      <TripList title={T.past[lang]} trips={trips.past} lang={lang} onOpen={setOpenTrip} muted />
    </>,
  );
}

function CurrentTrip({ trip, token, lang, onOpen }: { trip: Trip; token: string; lang: Lang; onOpen: () => void }) {
  const report = useMutation(api.portal.reportDelay);
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState(false);
  const alert = ["late", "recovery_calling", "needs_human", "delayed"].includes(trip.status);

  async function send(minutesLate?: number) {
    setAsking(false);
    const r = await report({ token, rideId: trip.id, minutesLate });
    if (r.ok) setSent(true);
  }

  return (
    <div className={`rounded-2xl border-2 p-5 ${alert ? "border-orange-400 bg-orange-50" : "border-emerald-400 bg-emerald-50"}`}>
      <p className="text-2xl font-bold leading-snug">{trip.statusText[lang]}</p>
      <dl className="mt-4 space-y-2">
        <Row label={trip.destinationName ?? ""} value={day(trip.appointmentAt, lang) && `${day(trip.appointmentAt, lang)}, ${time(trip.appointmentAt, lang)}`} />
        {trip.replacement ? (
          <>
            <Row label={T.replacement[lang]} value={window_(trip.replacement.windowStart, trip.replacement.windowEnd, lang)} />
            <Row label={T.confirmation[lang]} value={trip.replacement.confirmationNumber} mono />
          </>
        ) : (
          <>
            <Row label={T.pickup[lang]} value={window_(trip.pickupWindowStart, trip.pickupWindowEnd, lang)} />
            {trip.estimatedPickupAt && <Row label={T.eta[lang]} value={time(trip.estimatedPickupAt, lang)} />}
            {trip.confirmationNumber && <Row label={T.confirmation[lang]} value={trip.confirmationNumber} mono />}
          </>
        )}
      </dl>

      {sent && <p className="mt-4 font-semibold">{T.sent[lang]}</p>}

      {trip.canReportDelay && !asking && (
        <button onClick={() => setAsking(true)} className="mt-5 w-full rounded-xl bg-orange-600 px-5 py-4 text-2xl font-bold text-white active:bg-orange-700">
          {T.late[lang]}
        </button>
      )}
      {asking && (
        <div className="mt-5">
          <p className="mb-3 font-semibold">{T.howLate[lang]}</p>
          <div className="grid grid-cols-2 gap-3">
            {[10, 20, 30].map((m) => (
              <button key={m} onClick={() => send(m)} className="rounded-xl bg-orange-600 py-4 text-xl font-bold text-white">
                {m} {T.minutes[lang]}
              </button>
            ))}
            <button onClick={() => send(undefined)} className="rounded-xl bg-orange-600 py-4 text-xl font-bold text-white">
              {T.notSure[lang]}
            </button>
          </div>
          <button onClick={() => setAsking(false)} className="mt-3 w-full py-2 text-lg text-slate-600 underline">
            {T.cancel[lang]}
          </button>
        </div>
      )}

      <button onClick={onOpen} className="mt-4 text-lg text-sky-800 underline">
        {T.details[lang]}
      </button>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-base text-slate-600">{label}</dt>
      <dd className={`font-semibold ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function TripList({ title, trips, lang, onOpen, muted }: { title: string; trips: Trip[]; lang: Lang; onOpen: (id: Id<"rides">) => void; muted?: boolean }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-slate-500">{title}</h2>
      {trips.length === 0 ? (
        <p className="text-slate-500">{T.none[lang]}</p>
      ) : (
        <ul className="space-y-3">
          {trips.map((t) => (
            <li key={t.id}>
              <button onClick={() => onOpen(t.id)} className={`w-full rounded-xl border border-slate-200 p-4 text-left ${muted ? "text-slate-600" : ""}`}>
                <div className="font-semibold">
                  {t.destinationName} · {day(t.appointmentAt, lang)}
                </div>
                <div className="text-lg">{t.statusText[lang]}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TripDetail({ token, rideId, lang, onBack }: { token: string; rideId: Id<"rides">; lang: Lang; onBack: () => void }) {
  const detail = useQuery(api.portal.tripDetail, { token, rideId });
  if (detail === undefined) return <p className="text-slate-500">…</p>;
  if (detail === null) return <p>{T.badLink[lang]}</p>;
  const { trip, timeline } = detail;
  return (
    <>
      <button onClick={onBack} className="mb-5 text-lg text-sky-800 underline">
        ← {T.back[lang]}
      </button>
      <h1 className="text-2xl font-bold">{trip.destinationName}</h1>
      <p className="mb-4 text-slate-600">{day(trip.appointmentAt, lang)}, {time(trip.appointmentAt, lang)}</p>
      <p className="mb-6 rounded-xl bg-slate-100 p-4 text-2xl font-bold">{trip.statusText[lang]}</p>
      <dl className="mb-8 space-y-2">
        <Row label={T.pickup[lang]} value={window_(trip.pickupWindowStart, trip.pickupWindowEnd, lang)} />
        {trip.confirmationNumber && <Row label={T.confirmation[lang]} value={trip.confirmationNumber} mono />}
        {trip.replacement && <Row label={T.replacement[lang]} value={`${window_(trip.replacement.windowStart, trip.replacement.windowEnd, lang)} · ${trip.replacement.confirmationNumber}`} />}
      </dl>
      <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-slate-500">{T.history[lang]}</h2>
      <ol className="space-y-3 border-l-4 border-slate-200 pl-4">
        {timeline.map((e, i) => (
          <li key={i}>
            <div className="text-base text-slate-500">{time(e.at, lang)}</div>
            <div>{e.text[lang]}</div>
          </li>
        ))}
      </ol>
    </>
  );
}
