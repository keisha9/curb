/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as brain from "../brain.js";
import type * as brainData from "../brainData.js";
import type * as calls from "../calls.js";
import type * as cartesiaAdmin from "../cartesiaAdmin.js";
import type * as cartesiaSetup from "../cartesiaSetup.js";
import type * as delays from "../delays.js";
import type * as demo from "../demo.js";
import type * as events from "../events.js";
import type * as extract from "../extract.js";
import type * as http from "../http.js";
import type * as lib_brainTools from "../lib/brainTools.js";
import type * as lib_cartesia from "../lib/cartesia.js";
import type * as lib_llm from "../lib/llm.js";
import type * as lib_ops from "../lib/ops.js";
import type * as lib_outbound from "../lib/outbound.js";
import type * as lib_policy from "../lib/policy.js";
import type * as lib_safety from "../lib/safety.js";
import type * as lib_stateMachine from "../lib/stateMachine.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_trips from "../lib/trips.js";
import type * as lib_voiceAgents from "../lib/voiceAgents.js";
import type * as lib_wording from "../lib/wording.js";
import type * as messages from "../messages.js";
import type * as portal from "../portal.js";
import type * as prompts_brain from "../prompts/brain.js";
import type * as prompts_brokerCaller from "../prompts/brokerCaller.js";
import type * as prompts_extractor from "../prompts/extractor.js";
import type * as prompts_inbound from "../prompts/inbound.js";
import type * as prompts_riderCallback from "../prompts/riderCallback.js";
import type * as rides from "../rides.js";
import type * as sim from "../sim.js";
import type * as usage from "../usage.js";
import type * as voiceConfig from "../voiceConfig.js";
import type * as voiceTools from "../voiceTools.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  brain: typeof brain;
  brainData: typeof brainData;
  calls: typeof calls;
  cartesiaAdmin: typeof cartesiaAdmin;
  cartesiaSetup: typeof cartesiaSetup;
  delays: typeof delays;
  demo: typeof demo;
  events: typeof events;
  extract: typeof extract;
  http: typeof http;
  "lib/brainTools": typeof lib_brainTools;
  "lib/cartesia": typeof lib_cartesia;
  "lib/llm": typeof lib_llm;
  "lib/ops": typeof lib_ops;
  "lib/outbound": typeof lib_outbound;
  "lib/policy": typeof lib_policy;
  "lib/safety": typeof lib_safety;
  "lib/stateMachine": typeof lib_stateMachine;
  "lib/time": typeof lib_time;
  "lib/tokens": typeof lib_tokens;
  "lib/trips": typeof lib_trips;
  "lib/voiceAgents": typeof lib_voiceAgents;
  "lib/wording": typeof lib_wording;
  messages: typeof messages;
  portal: typeof portal;
  "prompts/brain": typeof prompts_brain;
  "prompts/brokerCaller": typeof prompts_brokerCaller;
  "prompts/extractor": typeof prompts_extractor;
  "prompts/inbound": typeof prompts_inbound;
  "prompts/riderCallback": typeof prompts_riderCallback;
  rides: typeof rides;
  sim: typeof sim;
  usage: typeof usage;
  voiceConfig: typeof voiceConfig;
  voiceTools: typeof voiceTools;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
