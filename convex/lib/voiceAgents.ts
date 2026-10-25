// Cartesia Managed Agents definitions: webhook tools and the four agents.
// Applied by cartesiaSetup:run. Agent and tool names are generic (README "Naming").

import { APP_NAME_SPOKEN } from "../../shared/config";
import { BROKER_CALLER_INITIAL_MESSAGE, BROKER_CALLER_PROMPT } from "../prompts/brokerCaller";
import { INBOUND_INITIAL_MESSAGE, INBOUND_PROMPT } from "../prompts/inbound";
import { RIDER_CALLBACK_INITIAL_MESSAGE, RIDER_CALLBACK_PROMPT } from "../prompts/riderCallback";

export const VOICE_MODEL = "claude-haiku-5.5";
export const TIMEZONE = "America/Los_Angeles";

// Picked from GET /voices: Spanish (es-MX) for the rider line, distinct English voice for brokers.
export const VOICES = {
  riderEs: "3597a26f-80ef-4bd5-8101-9699bc764917", // Ximena
  riderEn: "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4", // Skylar
  broker: "47c38ca4-5f35-497b-b1a3-415245fb35e1", // Daniel
};

type Prop = { type: "string" | "number" | "boolean"; description?: string; enum?: string[] };

export type ToolSpec = {
  name: string;
  description: string;
  params: Record<string, Prop>;
  required: string[];
  /** JSON fields of the response saved as dynamic variables. */
  assignments?: string[];
};

const iso = (what: string): Prop => ({ type: "string", description: `${what}, local ISO 8601 without offset, e.g. 2026-10-26T07:30` });

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "identify_caller",
    description: "Call first on every inbound call, before speaking. Says whether the caller is a member, a ride company, or unknown, with their details.",
    params: {},
    required: [],
    assignments: ["caller_kind", "member_name", "language"],
  },
  {
    name: "check_eligibility",
    description: "Checks the member's ride paperwork for an appointment time. Deterministic policy; follow its answer.",
    params: { appointmentAt: iso("Appointment date and time") },
    required: ["appointmentAt"],
  },
  {
    name: "submit_ride_request",
    description: "Submits the ride request after the member clearly confirmed the read-back. Never call before a clear yes.",
    params: {
      appointmentAt: iso("Appointment date and time"),
      appointmentType: { type: "string", description: "e.g. dialysis" },
      destinationName: { type: "string" },
      destinationAddress: { type: "string" },
      pickupAddress: { type: "string" },
      mobility: { type: "string", enum: ["ambulatory", "wheelchair", "gurney"] },
      riderConfirmed: { type: "boolean", description: "true only after the member clearly said yes to the read-back" },
      language: { type: "string", enum: ["en", "es"], description: "Language the member is speaking" },
    },
    required: ["appointmentAt", "appointmentType", "destinationName", "destinationAddress", "pickupAddress", "mobility", "riderConfirmed", "language"],
  },
  {
    name: "report_delay_rider",
    description: "Records that the member's driver is late or has not arrived. Returns what to tell the member.",
    params: {
      minutesLate: { type: "number", description: "Roughly how many minutes late, if the member said" },
      note: { type: "string" },
    },
    required: [],
  },
  {
    name: "get_ride_status",
    description: "Current status of the member's upcoming ride, in plain words.",
    params: {},
    required: [],
  },
  {
    name: "lookup_ride",
    description: "Ride company callers only: finds a ride by confirmation number. Returns minimal details.",
    params: { confirmationNumber: { type: "string" } },
    required: ["confirmationNumber"],
  },
  {
    name: "confirm_booking",
    description: "Records the ride company's booking confirmation number and pickup window.",
    params: {
      confirmationNumber: { type: "string" },
      pickupWindowStart: iso("Pickup window start"),
      pickupWindowEnd: iso("Pickup window end"),
    },
    required: ["confirmationNumber", "pickupWindowStart", "pickupWindowEnd"],
  },
  {
    name: "report_delay_broker",
    description: "Records a driver delay reported by the ride company. Returns the next step; follow it.",
    params: {
      confirmationNumber: { type: "string", description: "Needed when the ride company called us" },
      delayMinutes: { type: "number", description: "Minutes late, if stated" },
      newEstimatedPickupAt: iso("New estimated pickup, if stated"),
      reason: { type: "string" },
    },
    required: [],
  },
  {
    name: "confirm_replacement",
    description: "Records the urgent replacement ride's confirmation number and pickup window.",
    params: {
      confirmationNumber: { type: "string" },
      pickupWindowStart: iso("Pickup window start"),
      pickupWindowEnd: iso("Pickup window end"),
    },
    required: ["confirmationNumber", "pickupWindowStart", "pickupWindowEnd"],
  },
  {
    name: "report_refusal",
    description: "Records that the ride company refused, with the reason.",
    params: { reason: { type: "string" } },
    required: ["reason"],
  },
];

/** Values the server needs on every tool call, filled by Cartesia, never by the model. */
const HIDDEN = {
  conversation_id: { type: "string", dynamic_variable: "system__conversation_id" },
  caller_id: { type: "string", dynamic_variable: "system__caller_id" },
  app_call_id: { type: "string", dynamic_variable: "app_call_id" },
};

export function toolBody(spec: ToolSpec, siteUrl: string, secret: string) {
  return {
    type: "webhook",
    name: spec.name,
    description: spec.description,
    pre_tool_speech: spec.name === "identify_caller" ? "off" : "auto",
    execution_mode: "immediate",
    response_timeout_secs: 10,
    api_schema: {
      url: `${siteUrl}/voice/tools/${spec.name}`,
      method: "POST",
      request_body_schema: {
        type: "object",
        properties: { ...spec.params, ...HIDDEN },
        required: spec.required,
      },
      authentication: { mode: "bearer", token: { type: "secret", secret_description: "Convex tool secret", secret_value: secret } },
    },
    ...(spec.assignments ? { assignments: spec.assignments.map((f) => ({ dynamic_variable: f, value_path: f })) } : {}),
  };
}

export type AgentKey = "inbound" | "broker" | "callbackEn" | "callbackEs";

export const AGENT_NAMES: Record<AgentKey, string> = {
  inbound: "inbound-assistant",
  broker: "broker-caller",
  callbackEn: "rider-callback-en",
  callbackEs: "rider-callback-es",
};

const AGENT_TOOLS: Record<AgentKey, string[]> = {
  inbound: ["identify_caller", "check_eligibility", "submit_ride_request", "report_delay_rider", "get_ride_status", "lookup_ride", "report_delay_broker", "confirm_replacement", "report_refusal"],
  broker: ["confirm_booking", "report_delay_broker", "confirm_replacement", "report_refusal"],
  callbackEn: ["get_ride_status", "report_delay_rider"],
  callbackEs: ["get_ride_status", "report_delay_rider"],
};

const withName = (s: string) => s.replaceAll("{{appName}}", APP_NAME_SPOKEN);

export function agentConfig(key: AgentKey, toolIds: Record<string, string>, eventWebhookId: string | null) {
  const base = {
    model: { id: VOICE_MODEL },
    timezone: TIMEZONE,
    tools: AGENT_TOOLS[key].map((n) => toolIds[n]).filter((id): id is string => !!id).map((id) => ({ id })),
    system_tools: { end_call: { description: null, pre_tool_speech: "auto" } },
    event_webhook_id: eventWebhookId,
  };
  switch (key) {
    case "inbound":
      return {
        ...base,
        instructions: withName(INBOUND_PROMPT),
        initial_message: withName(INBOUND_INITIAL_MESSAGE),
        language: { primary: "es", additional: [{ code: "en" }] },
        audio: { output: { voice_id: VOICES.riderEs } },
      };
    case "broker":
      return {
        ...base,
        // Voicemail: hang up without a message; the brain retries the call later.
        system_tools: { ...base.system_tools, voicemail_detection: {} },
        instructions: BROKER_CALLER_PROMPT,
        initial_message: BROKER_CALLER_INITIAL_MESSAGE,
        language: { primary: "en" },
        audio: { output: { voice_id: VOICES.broker } },
      };
    case "callbackEn":
      return {
        ...base,
        // Voicemail can be heard by others: no ride details, just ask for a call back.
        system_tools: {
          ...base.system_tools,
          voicemail_detection: { message: `Hi, this is ${APP_NAME_SPOKEN} with an update about your ride. Please call us back at this number, or check your trips page.` },
        },
        instructions: withName(RIDER_CALLBACK_PROMPT.en),
        initial_message: withName(RIDER_CALLBACK_INITIAL_MESSAGE.en),
        language: { primary: "en" },
        audio: { output: { voice_id: VOICES.riderEn } },
      };
    case "callbackEs":
      return {
        ...base,
        system_tools: {
          ...base.system_tools,
          voicemail_detection: { message: `Hola, le llama ${APP_NAME_SPOKEN} con una actualización sobre su transporte. Por favor llámenos a este número, o revise su página de viajes.` },
        },
        instructions: withName(RIDER_CALLBACK_PROMPT.es),
        initial_message: withName(RIDER_CALLBACK_INITIAL_MESSAGE.es),
        language: { primary: "es" },
        audio: { output: { voice_id: VOICES.riderEs } },
      };
  }
}
