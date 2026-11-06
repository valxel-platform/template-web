import { csrfToken, session, signIn, signOut } from "./auth";

function respond(status: number, body: unknown) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
    ),
  );
}

describe("auth", () => {
  it("reads the CSRF token the BFF set", () => {
    expect(csrfToken("a=1; XSRF-TOKEN=abc%3D; b=2")).toBe("abc=");
    expect(csrfToken("a=1")).toBe("");
  });

  it("asks the BFF who is signed in, with the session cookie", async () => {
    const f = respond(200, { authenticated: true, sub: "u1" });
    await expect(session(f)).resolves.toEqual({ authenticated: true, sub: "u1" });
    expect(f).toHaveBeenCalledWith("/auth/me", expect.objectContaining({ credentials: "same-origin" }));
    await expect(session(respond(500, {}))).resolves.toEqual({ authenticated: false });
  });

  it("signs in and out through the BFF", async () => {
    const go = vi.fn();
    signIn(go);
    expect(go).toHaveBeenCalledWith("/auth/login");

    document.cookie = "XSRF-TOKEN=t1";
    const f = respond(200, { redirect: "https://id.example.com/logout?id_token_hint=x" });
    await signOut(f, go);
    expect(f).toHaveBeenCalledWith(
      "/auth/logout",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-XSRF-TOKEN": "t1" }) as unknown,
      }),
    );
    expect(go).toHaveBeenLastCalledWith("https://id.example.com/logout?id_token_hint=x");

    await signOut(
      vi.fn<typeof fetch>(() => Promise.resolve(new Response("not json"))),
      go,
    );
    expect(go).toHaveBeenLastCalledWith("/");
  });
});
