import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { ApiError, type ApiClient } from "./api/client";

function api(impl: ApiClient["greeting"]): ApiClient {
  return { greeting: impl };
}

describe("App", () => {
  it("greets the person by name", async () => {
    render(<App api={api((name) => Promise.resolve({ message: `Hello, ${name}!` }))} />);
    await userEvent.type(screen.getByLabelText("Your name"), "Ada");
    await userEvent.click(screen.getByRole("button", { name: "Greet me" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Hello, Ada!");
  });

  it("shows the API's explanation when the request is rejected", async () => {
    render(<App api={api(() => Promise.reject(new ApiError(400, "Name is too long")))} />);
    await userEvent.type(screen.getByLabelText("Your name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Greet me" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Name is too long");
  });

  it("does not leak unexpected errors", async () => {
    render(<App api={api(() => Promise.reject(new Error("socket hang up")))} />);
    await userEvent.type(screen.getByLabelText("Your name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Greet me" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
  });

  it("keeps the button disabled until a name is entered", () => {
    render(<App api={api(() => Promise.resolve({ message: "" }))} />);
    expect(screen.getByRole("button", { name: "Greet me" })).toBeDisabled();
  });
});
