import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App, type Auth } from "./App";
import { ApiError, type ApiClient } from "./api/client";

function api(impl: ApiClient["greeting"]): ApiClient {
  return { greeting: impl };
}

function auth(signedIn = true) {
  const signIn = vi.fn<() => void>();
  const signOut = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const a: Auth = {
    session: () =>
      Promise.resolve(signedIn ? { authenticated: true, sub: "u1", name: "Ada" } : { authenticated: false }),
    signIn,
    signOut,
  };
  return { ...a, signIn, signOut };
}

describe("App", () => {
  it("greets the person by name", async () => {
    render(<App api={api((name) => Promise.resolve({ message: `Hello, ${name}!` }))} auth={auth()} />);
    await userEvent.type(await screen.findByLabelText("Your name"), "Ada");
    await userEvent.click(screen.getByRole("button", { name: "Greet me" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Hello, Ada!");
  });

  it("shows the API's explanation when the request is rejected", async () => {
    render(<App api={api(() => Promise.reject(new ApiError(400, "Name is too long")))} auth={auth()} />);
    await userEvent.type(await screen.findByLabelText("Your name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Greet me" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Name is too long");
  });

  it("does not leak unexpected errors", async () => {
    render(<App api={api(() => Promise.reject(new Error("socket hang up")))} auth={auth()} />);
    await userEvent.type(await screen.findByLabelText("Your name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Greet me" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
  });

  it("keeps the button disabled until a name is entered", async () => {
    render(<App api={api(() => Promise.resolve({ message: "" }))} auth={auth()} />);
    expect(await screen.findByRole("button", { name: "Greet me" })).toBeDisabled();
  });

  it("asks people who aren't signed in to sign in", async () => {
    const a = auth(false);
    render(<App api={api(() => Promise.resolve({ message: "" }))} auth={a} />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(a.signIn).toHaveBeenCalled();
    expect(screen.queryByLabelText("Your name")).toBeNull();
  });

  it("shows who is signed in and signs them out", async () => {
    const a = auth();
    render(<App api={api(() => Promise.resolve({ message: "" }))} auth={a} />);
    expect(await screen.findByText("Signed in as Ada")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(a.signOut).toHaveBeenCalled();
  });

  it("offers to sign in again when the session has ended", async () => {
    render(<App api={api(() => Promise.reject(new ApiError(401, "Unauthorized")))} auth={auth()} />);
    await userEvent.type(await screen.findByLabelText("Your name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Greet me" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your session has ended. Sign in again.");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("treats a failed session check as signed out", async () => {
    const a = { ...auth(), session: () => Promise.reject(new Error("offline")) };
    render(<App api={api(() => Promise.resolve({ message: "" }))} auth={a} />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});
