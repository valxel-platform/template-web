import { ApiError } from "../api/client";
import { createChatClient } from "./client";

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

class FakeSource {
  listeners = new Map<string, (e: MessageEvent<string>) => void>();
  closed = false;
  constructor(readonly url: string) {}
  addEventListener(kind: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.set(kind, fn);
  }
  close() {
    this.closed = true;
  }
  fire(kind: string, data: unknown) {
    this.listeners.get(kind)?.(new MessageEvent(kind, { data: JSON.stringify(data) }));
  }
}

describe("chat client", () => {
  beforeEach(() => {
    document.cookie = "XSRF-TOKEN=tok-1";
  });

  it("sends messages with the CSRF token, through the BFF", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(respond(202, { conversation_id: "conv-1", after: 4 })),
    );
    const c = createChatClient("/api/agent", fetchImpl);
    expect(await c.start("hello")).toEqual({ conversation_id: "conv-1", after: 4 });
    await c.send("conv-1", "more");
    await c.decide("conv-1", "approve", ["tu_1"]);
    const call = (i: number): [RequestInfo | URL, RequestInit] => {
      const c = fetchImpl.mock.calls[i];
      if (!c) throw new Error(`no call ${String(i)}`);
      return [c[0], c[1] ?? {}];
    };
    const [url, init] = call(0);
    expect(url).toBe("/api/agent/conversations");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>)["X-XSRF-TOKEN"]).toBe("tok-1");
    expect(JSON.parse(init.body as string)).toEqual({ text: "hello" });
    expect(call(1)[0]).toBe("/api/agent/conversations/conv-1/messages");
    expect(JSON.parse(call(2)[1].body as string)).toEqual({
      decision: "approve",
      approved_ids: ["tu_1"],
    });
  });

  it("reads a conversation without a body or CSRF header", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(respond(200, { conversation_id: "conv-1", messages: [] })),
    );
    await createChatClient("/api/agent", fetchImpl).get("conv-1");
    const init = fetchImpl.mock.calls[0]?.[1] ?? {};
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toHaveProperty("X-XSRF-TOKEN");
  });

  it("turns refusals into ApiErrors with the agent's explanation and trace", async () => {
    const trace = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        respond(409, { detail: "Decide on the proposed change first." }, { traceresponse: trace }),
      ),
    );
    const err = await createChatClient("/api/agent", fetchImpl)
      .send("conv-abc-1", "x")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 409,
      detail: "Decide on the proposed change first.",
      endpoint: "POST /api/agent/conversations/{id}/messages",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    });
    const plain = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("oops", { status: 502, statusText: "Bad Gateway" })),
    );
    await expect(createChatClient("/api/agent", plain).get("conv-1")).rejects.toMatchObject({
      detail: "Bad Gateway",
    });
  });

  it("streams the reply and stops at the end of the turn", () => {
    let es: FakeSource | undefined;
    const c = createChatClient("/api/agent", fetch, (url) => (es = new FakeSource(url)));
    const got: string[] = [];
    const stop = c.stream("conv-1", 7, {
      text: (d) => got.push(`text:${d}`),
      step: (s) => got.push(`step:${s.title}`),
      approval: (a) => got.push(`approval:${String(a.length)}`),
      problem: (t) => got.push(`problem:${t}`),
      idle: (s) => got.push(`idle:${s}`),
    });
    expect(es?.url).toBe("/api/agent/conversations/conv-1/stream?after=7");
    es?.fire("text", { delta: "Hel" });
    es?.fire("step", { tool: "care__find_patient", title: "Find a patient", ok: true });
    es?.fire("approval", { actions: [{ id: "tu_1", tool: "care__create_task" }] });
    es?.fire("problem", { text: "" }); // cleared: nothing to show
    es?.fire("problem", { text: "The last step failed" });
    es?.fire("idle", { status: "idle" });
    expect(got).toEqual([
      "text:Hel",
      "step:Find a patient",
      "approval:1",
      "problem:The last step failed",
      "idle:idle",
    ]);
    expect(es?.closed).toBe(true);
    stop();
  });

  it("closes a stream the person leaves", () => {
    let es: FakeSource | undefined;
    const stop = createChatClient("/api/agent", fetch, (url) => (es = new FakeSource(url))).stream(
      "conv-1",
      0,
      {},
    );
    es?.fire("text", {});
    es?.fire("approval", {});
    es?.fire("idle", {});
    stop();
    expect(es?.closed).toBe(true);
  });
});
