import { ApiError, createApiClient } from "./client";

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
    await expect(call.greeting("")).rejects.toEqual(
      new ApiError(400, "name: size must be between 1 and 100"),
    );
  });

  it("falls back to the status text when the body is not JSON", async () => {
    const call = createApiClient("", () =>
      Promise.resolve(new Response("oops", { status: 502, statusText: "Bad Gateway" })),
    );
    await expect(call.greeting("x")).rejects.toMatchObject({ status: 502, detail: "Bad Gateway" });
  });
});
