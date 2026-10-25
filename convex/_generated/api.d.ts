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
import type * as delays from "../delays.js";
import type * as demo from "../demo.js";
import type * as events from "../events.js";
import type * as extract from "../extract.js";
import type * as lib_brainTools from "../lib/brainTools.js";
import type * as lib_llm from "../lib/llm.js";
import type * as lib_outbound from "../lib/outbound.js";
import type * as lib_policy from "../lib/policy.js";
import type * as lib_safety from "../lib/safety.js";
import type * as lib_stateMachine from "../lib/stateMachine.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_trips from "../lib/trips.js";
import type * as lib_wording from "../lib/wording.js";
import type * as messages from "../messages.js";
import type * as portal from "../portal.js";
import type * as prompts_brain from "../prompts/brain.js";
import type * as prompts_brokerCaller from "../prompts/brokerCaller.js";
import type * as prompts_brokerInbound from "../prompts/brokerInbound.js";
import type * as prompts_extractor from "../prompts/extractor.js";
import type * as prompts_rider from "../prompts/rider.js";
import type * as prompts_riderCallback from "../prompts/riderCallback.js";
import type * as rides from "../rides.js";
import type * as sim from "../sim.js";
import type * as usage from "../usage.js";
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
  delays: typeof delays;
  demo: typeof demo;
  events: typeof events;
  extract: typeof extract;
  "lib/brainTools": typeof lib_brainTools;
  "lib/llm": typeof lib_llm;
  "lib/outbound": typeof lib_outbound;
  "lib/policy": typeof lib_policy;
  "lib/safety": typeof lib_safety;
  "lib/stateMachine": typeof lib_stateMachine;
  "lib/time": typeof lib_time;
  "lib/tokens": typeof lib_tokens;
  "lib/trips": typeof lib_trips;
  "lib/wording": typeof lib_wording;
  messages: typeof messages;
  portal: typeof portal;
  "prompts/brain": typeof prompts_brain;
  "prompts/brokerCaller": typeof prompts_brokerCaller;
  "prompts/brokerInbound": typeof prompts_brokerInbound;
  "prompts/extractor": typeof prompts_extractor;
  "prompts/rider": typeof prompts_rider;
  "prompts/riderCallback": typeof prompts_riderCallback;
  rides: typeof rides;
  sim: typeof sim;
  usage: typeof usage;
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
