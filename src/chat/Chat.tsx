import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { ApiError } from "../api/client";
import { reportError } from "../errors";
import type { ChatClient, ChatMessage, Step, Waiting } from "./client";

const MAX_CHARS = 8000; // the agent's AGENT_CHAT_MAX_CHARS

interface Live {
  text: string;
  steps: Step[];
}

/** A conversation with the product's agent: the reply appears as it is written, with the steps
 * it takes, and a change it proposes waits here for the person to approve or decline. */
export function Chat({ chat, signedOut }: { chat: ChatClient; signedOut?: () => void }) {
  const [id, setId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [live, setLive] = useState<Live | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stop = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      stop.current?.();
    },
    [],
  );

  function fail(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      setError("Your session has ended. Sign in again.");
      signedOut?.();
      return;
    }
    if (err instanceof ApiError && err.status === 409) {
      setError("The assistant is still working on the last message. Try again in a moment.");
      return;
    }
    setError(err instanceof ApiError && err.status < 500 ? err.detail : "Something went wrong. Try again.");
    if (!(err instanceof ApiError) || err.status >= 500) reportError(err);
  }

  async function settle(cid: string) {
    try {
      const c = await chat.get(cid);
      setMessages(c.messages);
      setWaiting(c.waiting_for);
      if (c.status === "failed") setError(c.problem || "Something went wrong. Try again.");
    } catch (err) {
      fail(err);
    } finally {
      setLive(null);
      setBusy(false);
    }
  }

  function follow(cid: string, after: number) {
    stop.current?.();
    setLive({ text: "", steps: [] });
    stop.current = chat.stream(cid, after, {
      text: (delta) => {
        setLive((l) => l && { ...l, text: l.text + delta });
      },
      step: (step) => {
        setLive((l) => l && { ...l, steps: [...l.steps, step] });
      },
      problem: setError,
      idle: () => void settle(cid),
    });
  }

  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setError(null);
    setBusy(true);
    setDraft("");
    setMessages((m) => [...m, { role: "user", text }]);
    try {
      const sent = id ? await chat.send(id, text) : await chat.start(text);
      setId(sent.conversation_id);
      follow(sent.conversation_id, sent.after);
    } catch (err) {
      setBusy(false);
      fail(err);
    }
  }

  async function decide(decision: string) {
    if (!id) return;
    setError(null);
    setBusy(true);
    setWaiting(null);
    try {
      follow(id, (await chat.decide(id, decision)).after);
    } catch (err) {
      setBusy(false);
      fail(err);
      void settle(id);
    }
  }

  return (
    <section aria-labelledby="chat-heading">
      <h2 id="chat-heading">Ask the assistant</h2>
      <ol aria-label="Conversation">
        {messages.map((m, i) => (
          <li key={i}>
            <strong>{m.role === "user" ? "You" : "Assistant"}</strong>
            {m.steps && m.steps.length > 0 && (
              <ul aria-label="What the assistant did">
                {m.steps.map((s, j) => (
                  <li key={j}>{s.title}</li>
                ))}
              </ul>
            )}
            <p>{m.text}</p>
          </li>
        ))}
        {live && (
          <li aria-live="polite" aria-busy="true">
            <strong>Assistant</strong>
            {live.steps.length > 0 && (
              <ul aria-label="What the assistant is doing">
                {live.steps.map((s, j) => (
                  <li key={j}>
                    {s.title}
                    {s.ok === false ? " (failed)" : ""}
                  </li>
                ))}
              </ul>
            )}
            <p>{live.text || "Working on it…"}</p>
          </li>
        )}
      </ol>

      {waiting?.type === "approval" && (
        <div role="group" aria-labelledby="proposal-heading">
          <h3 id="proposal-heading">The assistant wants to make a change</h3>
          <ul>
            {(waiting.actions ?? []).map((a) => (
              <li key={a.id}>
                {(a.description ?? a.title ?? a.tool).split("\n")[0]}
                <details>
                  <summary>Details</summary>
                  <pre>{JSON.stringify(a.input ?? {}, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => void decide("approve")}>
            Approve
          </button>
          <button type="button" onClick={() => void decide("reject")}>
            Decline
          </button>
        </div>
      )}
      {waiting?.type === "takeover" && (
        <div role="group" aria-labelledby="takeover-heading">
          <h3 id="takeover-heading">The assistant stopped</h3>
          <p>{waiting.reason}</p>
          <button type="button" onClick={() => void decide("resume")}>
            Keep going
          </button>
          <button type="button" onClick={() => void decide("stop")}>
            Stop
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}

      <form onSubmit={(e) => void submit(e)}>
        <label htmlFor="chat-message">Message</label>
        <textarea
          id="chat-message"
          value={draft}
          maxLength={MAX_CHARS}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
        />
        <button type="submit" disabled={busy || waiting !== null || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
