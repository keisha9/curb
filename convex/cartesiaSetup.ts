// Creates or updates everything on Cartesia: webhook tools, the call-event webhook, the four
// agents, and the phone number. Idempotent: finds existing resources by name or URL.
//   npx convex run cartesiaSetup:run                         # tools, webhook, agents
//   npx convex run cartesiaSetup:run '{"provisionNumber":true}'  # also claim the free Cartesia number

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { cartesia, cartesiaConfigured, type CartesiaResponse } from "./lib/cartesia";
import { AGENT_NAMES, TOOL_SPECS, agentConfig, toolBody, type AgentKey } from "./lib/voiceAgents";

type Named = { id: string; name?: string; url?: string };

function list(r: CartesiaResponse): Named[] {
  const b = r.body as { data?: Named[]; summaries?: Named[] } | Named[] | null;
  if (Array.isArray(b)) return b;
  return b?.data ?? b?.summaries ?? [];
}

function fail(step: string, r: CartesiaResponse): never {
  throw new Error(`${step} failed (${r.status}): ${JSON.stringify(r.body).slice(0, 800)}`);
}

export const run = internalAction({
  args: { provisionNumber: v.optional(v.boolean()) },
  handler: async (ctx, { provisionNumber }): Promise<unknown> => {
    if (!cartesiaConfigured()) throw new Error("CARTESIA_API_KEY is not set");
    const secret = process.env.VOICE_WEBHOOK_SECRET;
    if (!secret) throw new Error("VOICE_WEBHOOK_SECRET is not set");
    const site = process.env.CONVEX_SITE_URL;
    if (!site) throw new Error("CONVEX_SITE_URL is not available");

    // 1. Webhook tools
    const existingTools = list(await cartesia("GET", "/v1/agents/tools"));
    const toolIds: Record<string, string> = {};
    for (const spec of TOOL_SPECS) {
      const body = toolBody(spec, site, secret);
      const found = existingTools.find((t) => t.name === spec.name);
      // A tool's type cannot change, and PATCH rejects the field.
      const { type: _type, ...patch } = body;
      const r = found
        ? await cartesia("PATCH", `/v1/agents/tools/${found.id}`, patch)
        : await cartesia("POST", "/v1/agents/tools", body);
      if (!r.ok) fail(`tool ${spec.name}`, r);
      toolIds[spec.name] = found?.id ?? (r.body as Named).id;
    }

    // 2. Call-event webhook
    const eventsUrl = `${site}/voice/events`;
    const hooks = list(await cartesia("GET", "/agents/webhooks"));
    let eventWebhookId = hooks.find((h) => h.url === eventsUrl)?.id;
    if (!eventWebhookId) {
      const r = await cartesia("POST", "/agents/webhooks", { url: eventsUrl, secret });
      if (!r.ok) fail("event webhook", r);
      eventWebhookId = (r.body as Named).id;
    }

    // 3. Agents
    const agents = list(await cartesia("GET", "/v1/agents"));
    const agentIds = {} as Record<AgentKey, string>;
    for (const key of Object.keys(AGENT_NAMES) as AgentKey[]) {
      const name = AGENT_NAMES[key];
      const config = agentConfig(key, toolIds, eventWebhookId ?? null);
      const found = agents.find((a) => a.name === name);
      const r = found
        ? await cartesia("PATCH", `/v1/agents/${found.id}`, { config })
        : await cartesia("POST", "/v1/agents", { name, config });
      if (!r.ok) fail(`agent ${name}`, r);
      agentIds[key] = found?.id ?? (r.body as Named).id;
    }

    // 4. Phone number (the free plan has one slot): reuse an existing one, else provision if asked.
    type PhoneNumber = { id: string; number?: string; agent?: { id: string } | null };
    let numbers = list(await cartesia("GET", "/agents/phone-numbers")) as PhoneNumber[];
    let numberStep: unknown = numbers.length ? "existing" : "none (pass provisionNumber: true to claim one)";
    if (!numbers.length && provisionNumber) {
      const r = await cartesia("POST", "/agents/phone-numbers/provision", { label: "inbound line" });
      if (!r.ok) fail("provision phone number", r);
      numbers = list(await cartesia("GET", "/agents/phone-numbers")) as PhoneNumber[];
      numberStep = { provisioned: r.body };
    }
    const number = numbers[0];
    let assignStep: unknown = null;
    if (number && number.agent?.id !== agentIds.inbound) {
      const r = await cartesia("PATCH", `/agents/phone-numbers/${number.id}`, { agent_id: agentIds.inbound });
      assignStep = { status: r.status, body: r.body };
    }

    await ctx.runMutation(internal.voiceConfig.save, {
      inboundAgentId: agentIds.inbound,
      brokerAgentId: agentIds.broker,
      callbackAgentIdEn: agentIds.callbackEn,
      callbackAgentIdEs: agentIds.callbackEs,
      fromNumberId: number?.id,
      phoneNumber: number?.number,
      eventWebhookId,
      toolIds,
    });
    return { toolIds, eventWebhookId, agentIds, number: number ?? null, numberStep, assignStep };
  },
});
