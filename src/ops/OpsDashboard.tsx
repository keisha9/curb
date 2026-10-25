// Ops dashboard (/ops): live ride board, call transcripts, decision log, delay reports,
// demo controls, and the QR code that opens a rider's trips page. Demo only: no login.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { APP_NAME, TIME_ZONE } from "../../shared/config";

const STATUS_STYLE: Record<string, string> = {
  collecting: "bg-slate-100 text-slate-700",
  needs_info: "bg-slate-100 text-slate-700",
  requested: "bg-sky-100 text-sky-800",
  calling_broker: "bg-sky-100 text-sky-800",
  booked: "bg-emerald-100 text-emerald-800",
  delayed: "bg-amber-100 text-amber-800",
  late: "bg-orange-100 text-orange-800",
  recovery_calling: "bg-orange-100 text-orange-800",
  replacement_booked: "bg-emerald-100 text-emerald-800",
  needs_human: "bg-red-100 text-red-800",
  ineligible: "bg-red-50 text-red-700",
  completed: "bg-slate-100 text-slate-500",
  cancelled: "bg-slate-100 text-slate-500",
};

const KIND_STYLE: Record<string, string> = {
  decision: "text-violet-700",
  policy_check: "text-sky-700",
  status_change: "text-emerald-700",
  delay_report: "text-orange-700",
  tool_call: "text-slate-500",
  call: "text-slate-500",
  sms: "text-slate-500",
  error: "text-red-700",
};

const fmt = (ts: number | undefined | null, withDay = false) =>
  ts == null
    ? "—"
    : new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE,
        ...(withDay ? { weekday: "short", month: "short", day: "numeric" } : {}),
        hour: "numeric",
        minute: "2-digit",
        second: withDay ? undefined : "2-digit",
      }).format(ts);

const windowText = (a?: number, b?: number) => (a == null ? "—" : `${fmt(a, true)} – ${fmt(b ?? a)}`.replace(/:\d\d (AM|PM)$/, " $1"));

function StatusChip({ status }: { status: string }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${STATUS_STYLE[status] ?? "bg-slate-100"}`}>{status.replace(/_/g, " ")}</span>;
}

function Panel({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{title}</h2>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

type LiveRide = Doc<"rides"> & { memberName: string; brokerName: string | null };

export function OpsDashboard() {
  const rides = useQuery(api.rides.listLive) as LiveRide[] | undefined;
  const state = useQuery(api.demo.state);
  const [picked, setPicked] = useState<Id<"rides"> | null>(null);

  // Follow the newest non-past ride unless the operator picked one.
  const activeRides = (rides ?? []).filter((r) => !["completed", "cancelled"].includes(r.status));
  const selectedId = picked ?? activeRides[0]?._id ?? null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-xl font-bold">{APP_NAME} · Ops</h1>
        {state?.systemNumber && (
          <span className="text-lg">
            Call <span className="font-mono font-semibold">{state.systemNumber}</span>
          </span>
        )}
        <span className="text-sm text-slate-500">Demo only · fake data · no login</span>
      </header>

      <main className="grid gap-4 p-4 lg:grid-cols-[22rem_1fr_20rem]">
        <div className="space-y-4">
          <Panel title="Rides">
            {rides === undefined ? (
              <p className="text-slate-500">Loading…</p>
            ) : rides.length === 0 ? (
              <p className="text-slate-500">No rides. Seed the demo, then call the number.</p>
            ) : (
              <ul className="space-y-2">
                {rides.map((r) => (
                  <li key={r._id}>
                    <button
                      onClick={() => setPicked(r._id)}
                      className={`w-full rounded-lg border p-3 text-left transition ${
                        r._id === selectedId ? "border-sky-500 bg-sky-50" : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{r.memberName}</span>
                        <StatusChip status={r.status} />
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        {r.destinationName ?? "—"} · {r.appointmentAt ? fmt(r.appointmentAt, true) : "no time yet"}
                      </div>
                      {r.needsHuman && <div className="mt-1 text-sm font-semibold text-red-700">Needs a person</div>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">{selectedId ? <RideDetail rideId={selectedId} /> : <LiveCalls />}</div>

        <div className="space-y-4">
          <TripsLinkPanel members={state?.members ?? []} />
          <DemoControls rideId={selectedId} delayMinutes={state?.delayMinutes ?? 20} brokerLine={state?.brokerLine ?? ""} />
        </div>
      </main>
    </div>
  );
}

function RideDetail({ rideId }: { rideId: Id<"rides"> }) {
  const data = useQuery(api.rides.get, { rideId });
  const events = useQuery(api.events.byRide, { rideId });
  const calls = useQuery(api.calls.byRide, { rideId });
  const reports = useQuery(api.delays.byRide, { rideId });
  const usage = useQuery(api.usage.byRide, { rideId });
  if (!data) return <Panel title="Ride">Loading…</Panel>;
  const { ride, member, broker } = data;
  const tokens = (usage ?? []).reduce((n, u) => n + u.inputTokens + u.outputTokens, 0);

  return (
    <>
      <Panel title="Ride" right={<StatusChip status={ride.status} />}>
        <div className="grid gap-x-6 gap-y-2 text-base sm:grid-cols-2">
          <Field label="Member" value={`${member?.name} · ${member?.plan} · ${ride.mobilitySnapshot ?? member?.mobility}`} />
          <Field label="Appointment" value={`${ride.destinationName ?? "—"} · ${fmt(ride.appointmentAt, true)}`} />
          <Field label="Pickup window" value={windowText(ride.pickupWindowStart, ride.pickupWindowEnd)} />
          <Field label="Confirmation" value={ride.brokerConfirmationNumber ?? "—"} mono />
          {ride.estimatedPickupAt && <Field label="Estimated pickup" value={fmt(ride.estimatedPickupAt, true)} />}
          {ride.replacementConfirmationNumber && (
            <Field
              label="Replacement"
              value={`${ride.replacementConfirmationNumber} · ${windowText(ride.replacementWindowStart, ride.replacementWindowEnd)}`}
              mono
            />
          )}
          <Field label="Broker" value={broker?.name ?? "—"} />
          <Field label="Claude usage" value={`${(usage ?? []).length} calls · ${tokens.toLocaleString()} tokens`} />
        </div>
      </Panel>

      <Panel title="Calls">
        {!calls?.length ? (
          <p className="text-slate-500">No calls yet.</p>
        ) : (
          <div className="space-y-4">
            {[...calls].reverse().map((c) => (
              <CallTranscript key={c._id} call={c} />
            ))}
          </div>
        )}
      </Panel>

      {!!reports?.length && (
        <Panel title="Delay reports">
          <ul className="space-y-2">
            {reports.map((r) => (
              <li key={r._id} className="rounded-lg bg-orange-50 p-3">
                <div className="font-semibold">
                  {r.reportedBy === "rider" ? "Rider" : "Broker"} via {r.channel.replace(/_/g, " ")}
                  {r.delayMinutes != null && ` · ${r.delayMinutes} min late`}
                  <span className="ml-2 text-sm font-normal text-slate-500">{fmt(r.createdAt)}</span>
                </div>
                <div className="text-sm">
                  {r.ignoredReason
                    ? `Ignored: ${r.ignoredReason.replace(/_/g, " ")}`
                    : r.evaluation && (
                        <>
                          Policy: <b>{r.evaluation.action.replace(/_/g, " ")}</b> ({r.evaluation.reasonCode.replace(/_/g, " ")}
                          {r.evaluation.minutesPastWindowStart != null && `, ${r.evaluation.minutesPastWindowStart} min past window start`}, threshold{" "}
                          {r.evaluation.thresholdMinutes})
                        </>
                      )}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Decision log">
        <ol className="space-y-1.5 font-mono text-sm">
          {[...(events ?? [])].reverse().map((e) => (
            <li key={e._id} className="flex gap-3">
              <span className="shrink-0 text-slate-400">{fmt(e.createdAt)}</span>
              <span className={`w-28 shrink-0 ${KIND_STYLE[e.kind] ?? ""}`}>{e.kind.replace(/_/g, " ")}</span>
              <span className="min-w-0 break-words">{e.summary}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={mono ? "font-mono" : ""}>{value}</div>
    </div>
  );
}

type CallWithLines = Doc<"calls"> & { label: string; lines: Doc<"transcriptLines">[] };

const SPEAKER_STYLE: Record<string, string> = {
  agent: "bg-sky-50 border-sky-200",
  rider: "bg-emerald-50 border-emerald-200",
  broker: "bg-amber-50 border-amber-200",
};

function CallTranscript({ call }: { call: CallWithLines }) {
  const live = call.status === "ringing" || call.status === "in_progress";
  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <span className="font-semibold">{call.label}</span>
        <span className="text-sm text-slate-500">
          {live ? <span className="font-semibold text-emerald-700">● {call.status.replace("_", " ")}</span> : call.status}
          {call.answered === false && " · not answered"} · {fmt(call.createdAt)}
        </span>
      </div>
      <div className="space-y-1.5 p-3">
        {call.lines.length === 0 && <p className="text-sm text-slate-400">{live ? "Waiting for speech…" : "No transcript."}</p>}
        {call.lines.map((l) => (
          <div key={l._id} className={`rounded-md border px-3 py-1.5 ${SPEAKER_STYLE[l.speaker] ?? ""}`}>
            <span className="mr-2 text-xs font-bold uppercase text-slate-500">{l.speaker}</span>
            {l.text}
          </div>
        ))}
        {call.summary && <p className="pt-1 text-sm italic text-slate-500">{call.summary}</p>}
      </div>
    </div>
  );
}

/** Shown before any ride exists: the latest calls, e.g. an inbound call still collecting details. */
function LiveCalls() {
  const calls = useQuery(api.calls.recent, { limit: 3 }) as CallWithLines[] | undefined;
  return (
    <Panel title="Latest calls">
      {!calls?.length ? <p className="text-slate-500">No calls yet.</p> : <div className="space-y-4">{calls.map((c) => <CallTranscript key={c._id} call={c} />)}</div>}
    </Panel>
  );
}

function TripsLinkPanel({ members }: { members: { id: Id<"members">; name: string }[] }) {
  const openLink = useMutation(api.demo.openTripsLink);
  const [memberId, setMemberId] = useState<Id<"members"> | "">("");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default to the first member (Maria in the seed data).
  useEffect(() => {
    if (!memberId && members[0]) setMemberId(members[0].id);
  }, [members, memberId]);

  const localhost = useMemo(() => ["localhost", "127.0.0.1"].includes(window.location.hostname), []);

  async function make() {
    if (!memberId) return;
    setError(null);
    try {
      const token = await openLink({ memberId });
      setUrl(`${window.location.origin}/trips?t=${token}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Panel title="Rider trips page">
      <div className="space-y-3">
        <div className="flex gap-2">
          <select
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5"
            value={memberId}
            onChange={(e) => {
              setMemberId(e.target.value as Id<"members">);
              setUrl(null);
            }}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button onClick={make} className="rounded-md bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-700">
            Show QR
          </button>
        </div>
        {url && (
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
              <QRCodeSVG value={url} size={200} />
            </div>
            <p className="text-center text-sm text-slate-600">Scan with the rider's phone. Link works for 14 days.</p>
            <a href={url} target="_blank" rel="noreferrer" className="break-all text-center text-xs text-sky-700 underline">
              {url}
            </a>
          </div>
        )}
        {localhost && url && (
          <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900">
            This page is open on localhost, so a phone can't reach the QR link. Open the dashboard at your computer's network address instead (the
            "Network" URL that <code>npm run dev</code> prints), on the same Wi-Fi.
          </p>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </Panel>
  );
}

function DemoControls({ rideId, delayMinutes, brokerLine }: { rideId: Id<"rides"> | null; delayMinutes: number; brokerLine: string }) {
  const seed = useMutation(api.demo.seed);
  const reset = useMutation(api.demo.reset);
  const simulate = useMutation(api.demo.simulateDelay);
  const setMinutes = useMutation(api.demo.setDelayMinutes);
  const setLine = useMutation(api.demo.setBrokerLine);
  const [confirmReset, setConfirmReset] = useState(false);
  const [line, setLineDraft] = useState(brokerLine);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setLineDraft(brokerLine), [brokerLine]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      setMsg(`${label}: done`);
    } catch (e) {
      setMsg(`${label}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
  };

  return (
    <Panel title="Demo controls">
      <div className="space-y-4">
        <div>
          <div className="mb-1 text-sm font-semibold">Simulate a delay on the selected ride</div>
          <div className="mb-2 flex items-center gap-2 text-sm">
            <input
              type="number"
              min={0}
              max={240}
              defaultValue={delayMinutes}
              key={delayMinutes}
              onBlur={(e) => run("Delay minutes", () => setMinutes({ delayMinutes: Number(e.target.value) }))}
              className="w-20 rounded-md border border-slate-300 px-2 py-1"
            />
            minutes late
          </div>
          <div className="flex gap-2">
            {(["rider", "broker"] as const).map((as) => (
              <button
                key={as}
                disabled={!rideId}
                onClick={() => run(`Delay as ${as}`, () => simulate({ rideId: rideId ?? undefined, as }))}
                className="flex-1 rounded-md bg-orange-600 px-3 py-1.5 font-semibold text-white hover:bg-orange-700 disabled:opacity-40"
              >
                As {as}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 text-sm font-semibold">Broker line</div>
          <div className="flex gap-2">
            <input value={line} onChange={(e) => setLineDraft(e.target.value)} className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 font-mono text-sm" />
            <button onClick={() => run("Broker line", () => setLine({ phone: line }))} className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">
              Save
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={() => run("Seed", () => seed({}))} className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
            Seed
          </button>
          {confirmReset ? (
            <button
              onClick={() => run("Reset", async () => (await reset({}), setConfirmReset(false)))}
              className="flex-1 rounded-md bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700"
            >
              Confirm reset
            </button>
          ) : (
            <button onClick={() => setConfirmReset(true)} className="flex-1 rounded-md border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50">
              Reset
            </button>
          )}
        </div>
        {confirmReset && <p className="text-sm text-slate-600">Reset deletes all rides, calls, and logs (members stay). Then press Seed.</p>}
        {msg && <p className="text-sm text-slate-600">{msg}</p>}
      </div>
    </Panel>
  );
}
