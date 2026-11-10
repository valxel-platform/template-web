/** Talking with the product's agent (template-agent), through the BFF at /api/agent: the BFF
 * adds the person's token, so the agent acts as them. Writes send the CSRF token like any other.
 *
 * Sending a message answers at once with `after`; the reply then streams (Server-Sent Events)
 * from that position: text as it is written, the tool steps it takes, a proposed change waiting
 * for the person, and `idle` when the turn is over. Any replica of the agent can serve the
 * stream, and EventSource resumes from the last event (Last-Event-ID) after a dropped connection. */

import { csrfToken } from "../auth";
import { ApiError, traceIdOf } from "../api/client";

export interface Step {
  tool: string;
  title: string;
  ok?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  steps?: Step[];
}

export interface ProposedAction {
  id: string;
  tool: string;
  description?: string;
  title?: string;
  input?: unknown;
}

export interface Waiting {
  type: "approval" | "takeover";
  actions?: ProposedAction[];
  summary?: string;
  reason?: string;
}

export type Status = "working" | "awaiting_review" | "needs_attention" | "idle" | "failed";

export interface Conversation {
  conversation_id: string;
  status: Status;
  waiting_for: Waiting | null;
  problem: string;
  messages: ChatMessage[];
  after: number;
}

export interface Sent {
  conversation_id: string;
  after: number;
}

export interface StreamHandlers {
  text?: (delta: string) => void;
  step?: (step: Step) => void;
  approval?: (actions: ProposedAction[]) => void;
  problem?: (text: string) => void;
  idle?: (status: string) => void;
}

export interface ChatClient {
  start: (text: string) => Promise<Sent>;
  send: (id: string, text: string) => Promise<Sent>;
  decide: (id: string, decision: string, approvedIds?: string[]) => Promise<Sent>;
  get: (id: string) => Promise<Conversation>;
  stream: (id: string, after: number, on: StreamHandlers) => () => void;
}

/** What the client needs of an EventSource (a fake in tests). */
export interface Source {
  addEventListener: (kind: string, listener: (e: MessageEvent<string>) => void) => void;
  close: () => void;
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

export function createChatClient(
  base = "/api/agent",
  fetchImpl: typeof fetch = fetch,
  source: (url: string) => Source = (url) => new EventSource(url),
): ChatClient {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json", "X-XSRF-TOKEN": csrfToken() }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const problem = (await res.json().catch(() => ({}))) as { detail?: unknown; title?: string };
      const detail = typeof problem.detail === "string" ? problem.detail : (problem.title ?? res.statusText);
      throw new ApiError(
        res.status,
        detail,
        `${method} ${base}${path.replace(/conv-[\w-]+/, "{id}")}`,
        traceIdOf(res),
      );
    }
    return (await res.json()) as T;
  }

  return {
    start: (text) => call<Sent>("POST", "/conversations", { text }),
    send: (id, text) => call<Sent>("POST", `/conversations/${encodeURIComponent(id)}/messages`, { text }),
    decide: (id, decision, approvedIds) =>
      call<Sent>("POST", `/conversations/${encodeURIComponent(id)}/decision`, {
        decision,
        ...(approvedIds ? { approved_ids: approvedIds } : {}),
      }),
    get: (id) => call<Conversation>("GET", `/conversations/${encodeURIComponent(id)}`),
    stream(id, after, on) {
      const es = source(`${base}/conversations/${encodeURIComponent(id)}/stream?after=${String(after)}`);
      const data = (e: MessageEvent<string>): Record<string, unknown> =>
        JSON.parse(e.data) as Record<string, unknown>;
      es.addEventListener("text", (e) => on.text?.(str(data(e).delta)));
      es.addEventListener("step", (e) => on.step?.(data(e) as unknown as Step));
      es.addEventListener("approval", (e) => on.approval?.((data(e).actions ?? []) as ProposedAction[]));
      es.addEventListener("problem", (e) => {
        const text = str(data(e).text);
        if (text) on.problem?.(text);
      });
      es.addEventListener("idle", (e) => {
        es.close(); // the turn is over: don't let EventSource reconnect
        on.idle?.(str(data(e).status, "idle"));
      });
      return () => {
        es.close();
      };
    },
  };
}
