import { ApiError, createApiClient, traceIdOf } from "./client";

function respond(status: number, body: unknown): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
    );
}

describe("createApiClient", () => {
  it("returns the greeting", async () => {
    await expect(
      createApiClient("", respond(200, { message: "Hello, Ada!" })).greeting("Ada"),
    ).resolves.toEqual({
      message: "Hello, Ada!",
    });
  });

  it("turns problem details into an ApiError", async () => {
    const call = createApiClient(
      "",
      respond(400, { title: "Bad Request", detail: "name: size must be between 1 and 100" }),
    );
    await expect(call.greeting("")).rejects.toMatchObject({
      status: 400,
      detail: "name: size must be between 1 and 100",
      endpoint: "GET /api/v1/greetings",
      traceId: "",
    });
  });

  it("keeps the trace the API named, so a reported error points at the backend's", async () => {
    const trace = "4bf92f3577b34da6a3ce929d0e0e4736";
    const call = createApiClient("", () =>
      Promise.resolve(
        new Response("{}", { status: 503, headers: { traceresponse: `00-${trace}-00f067aa0ba902b7-01` } }),
      ),
    );
    const err = await call.greeting("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ traceId: trace, status: 503 });
    expect(traceIdOf(new Response("", { headers: { traceresponse: "junk" } }))).toBe("");
  });

  it("falls back to the status text when the body is not JSON", async () => {
    const call = createApiClient("", () =>
      Promise.resolve(new Response("oops", { status: 502, statusText: "Bad Gateway" })),
    );
    await expect(call.greeting("x")).rejects.toMatchObject({ status: 502, detail: "Bad Gateway" });
  });
});
