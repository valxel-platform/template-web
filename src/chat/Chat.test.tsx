import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "../api/client";
import { reportError } from "../errors";
import { Chat } from "./Chat";
import type { ChatClient, Conversation, StreamHandlers } from "./client";

vi.mock("../errors", () => ({ reportError: vi.fn() }));

function conversation(over: Partial<Conversation> = {}): Conversation {
  return {
    conversation_id: "conv-1",
    status: "idle",
    waiting_for: null,
    problem: "",
    messages: [],
    after: 0,
    ...over,
  };
}

/** A fake agent: the test drives each stream's events. */
function fakeChat(over: Partial<ChatClient> = {}) {
  const streams: StreamHandlers[] = [];
  const closed: number[] = [];
  const client: ChatClient = {
    start: vi.fn(() => Promise.resolve({ conversation_id: "conv-1", after: 0 })),
    send: vi.fn(() => Promise.resolve({ conversation_id: "conv-1", after: 5 })),
    decide: vi.fn(() => Promise.resolve({ conversation_id: "conv-1", after: 9 })),
    get: vi.fn(() => Promise.resolve(conversation())),
    stream: vi.fn((_id: string, _after: number, on: StreamHandlers) => {
      streams.push(on);
      const n = streams.length;
      return () => closed.push(n);
    }),
    ...over,
  };
  const at = (i: number): StreamHandlers => {
    const s = streams[i];
    if (!s) throw new Error(`no stream ${String(i)}`);
    return s;
  };
  return { client, at, closed };
}

async function say(text: string) {
  await userEvent.type(screen.getByLabelText("Message"), text);
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
}

describe("Chat", () => {
  it("shows the reply as it is written, with its steps", async () => {
    const { client, at } = fakeChat({
      get: vi.fn(() =>
        Promise.resolve(
          conversation({
            messages: [
              { role: "user", text: "Who is Ana?" },
              {
                role: "assistant",
                text: "Ana is p-102.",
                steps: [{ tool: "care__find_patient", title: "Find a patient" }],
              },
            ],
          }),
        ),
      ),
    });
    render(<Chat chat={client} />);
    await say("Who is Ana?");
    expect(client.start).toHaveBeenCalledWith("Who is Ana?");
    expect(screen.getByText("Working on it…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    act(() => {
      at(0).step?.({ tool: "care__find_patient", title: "Find a patient", ok: true });
      at(0).step?.({ tool: "care__list_open_tasks", title: "List open tasks", ok: false });
      at(0).text?.("Ana ");
      at(0).text?.("is p-102.");
    });
    expect(screen.getByText("Ana is p-102.")).toBeInTheDocument();
    expect(screen.getByText("List open tasks (failed)")).toBeInTheDocument();
    act(() => {
      at(0).idle?.("idle");
    });
    await waitFor(() => {
      expect(screen.queryByText("Working on it…")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("list", { name: "What the assistant did" })).toHaveTextContent("Find a patient");

    await say("Thanks");
    expect(client.send).toHaveBeenCalledWith("conv-1", "Thanks");
    expect(client.stream).toHaveBeenLastCalledWith("conv-1", 5, expect.anything());
  });

  it("asks the person to approve a change, then carries on", async () => {
    const waiting = {
      type: "approval" as const,
      actions: [
        {
          id: "tu_2",
          tool: "care__create_task",
          description: "Create a task.\nMore.",
          input: { title: "Echo" },
        },
      ],
    };
    const get = vi
      .fn<ChatClient["get"]>()
      .mockResolvedValueOnce(conversation({ status: "awaiting_review", waiting_for: waiting }))
      .mockResolvedValueOnce(conversation({ messages: [{ role: "assistant", text: "Created." }] }));
    const { client, at } = fakeChat({ get });
    render(<Chat chat={client} />);
    await say("Book an echo");
    act(() => {
      at(0).idle?.("awaiting_review");
    });
    expect(
      await screen.findByRole("group", { name: "The assistant wants to make a change" }),
    ).toHaveTextContent("Create a task.");
    expect(screen.getByText(/"title": "Echo"/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Message"), "x");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled(); // decide first
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(client.decide).toHaveBeenCalledWith("conv-1", "approve");
    expect(client.stream).toHaveBeenLastCalledWith("conv-1", 9, expect.anything());
    act(() => {
      at(1).idle?.("idle");
    });
    expect(await screen.findByText("Created.")).toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("lets the person keep a stalled conversation going or stop it", async () => {
    const { client, at } = fakeChat({
      get: vi.fn(() =>
        Promise.resolve(
          conversation({
            status: "needs_attention",
            waiting_for: { type: "takeover", reason: "Out of steps." },
          }),
        ),
      ),
    });
    render(<Chat chat={client} />);
    await say("Do a lot");
    act(() => {
      at(0).idle?.("needs_attention");
    });
    expect(await screen.findByText("Out of steps.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep going" }));
    expect(client.decide).toHaveBeenCalledWith("conv-1", "resume");
  });

  it("explains refusals and reports faults", async () => {
    const send = vi
      .fn<ChatClient["send"]>()
      .mockRejectedValueOnce(new ApiError(409, "busy"))
      .mockRejectedValueOnce(new ApiError(422, "A message can be at most 8000 characters."))
      .mockRejectedValueOnce(new ApiError(503, "down"))
      .mockRejectedValueOnce(new Error("network"));
    const { client, at } = fakeChat({ send });
    render(<Chat chat={client} />);
    await say("first");
    act(() => {
      at(0).problem?.("The last step failed; see the service logs.");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("The last step failed");
    act(() => {
      at(0).idle?.("failed");
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send" })).toBeDisabled(); // empty draft
    });
    await say("again");
    expect(await screen.findByRole("alert")).toHaveTextContent("still working on the last message");
    await say("again");
    expect(await screen.findByRole("alert")).toHaveTextContent("at most 8000 characters");
    expect(reportError).not.toHaveBeenCalled();
    await say("again");
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
    await say("again");
    expect(reportError).toHaveBeenCalledTimes(2);
  });

  it("shows a failed turn's explanation", async () => {
    const { client, at } = fakeChat({
      get: vi.fn(() =>
        Promise.resolve(conversation({ status: "failed", problem: "The audit trail is unavailable." })),
      ),
    });
    render(<Chat chat={client} />);
    await say("hi");
    act(() => {
      at(0).idle?.("failed");
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("The audit trail is unavailable.");
  });

  it("says when the session ended, and closes its stream when it goes away", async () => {
    const signedOut = vi.fn();
    const { client, at, closed } = fakeChat({
      get: vi.fn(() => Promise.reject(new ApiError(401, "no"))),
    });
    const { unmount } = render(<Chat chat={client} signedOut={signedOut} />);
    await say("hi");
    act(() => {
      at(0).idle?.("idle");
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Your session has ended");
    expect(signedOut).toHaveBeenCalled();
    unmount();
    expect(closed).toContain(1);
  });

  it("re-reads the conversation when a decision is refused", async () => {
    const get = vi
      .fn<ChatClient["get"]>()
      .mockResolvedValue(
        conversation({ status: "awaiting_review", waiting_for: { type: "approval", actions: [] } }),
      );
    const { client, at } = fakeChat({
      get,
      decide: vi.fn(() => Promise.reject(new ApiError(409, "busy"))),
    });
    render(<Chat chat={client} />);
    await say("hi");
    act(() => {
      at(0).idle?.("awaiting_review");
    });
    await userEvent.click(await screen.findByRole("button", { name: "Decline" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("still working");
    expect(await screen.findByRole("button", { name: "Decline" })).toBeInTheDocument();
  });
});
