import { useEffect, useState, type SyntheticEvent } from "react";
import { ApiError, type ApiClient } from "./api/client";
import type { Session } from "./auth";
import { reportError } from "./errors";
import { Chat } from "./chat/Chat";
import type { ChatClient } from "./chat/client";

export interface Auth {
  session: () => Promise<Session>;
  signIn: () => void;
  signOut: () => Promise<void>;
}

export function App({ api, auth, chat }: { api: ApiClient; auth: Auth; chat?: ChatClient }) {
  const [who, setWho] = useState<Session | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    auth.session().then(setWho, () => {
      setWho({ authenticated: false });
    });
  }, [auth]);

  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setMessage((await api.greeting(name.trim())).message);
    } catch (err) {
      setMessage(null);
      if (err instanceof ApiError && err.status === 401) {
        setWho({ authenticated: false }); // the session ended: offer to sign in again
        setError("Your session has ended. Sign in again.");
      } else {
        setError(err instanceof ApiError ? err.detail : "Something went wrong. Try again.");
        // A failure the person saw that isn't theirs to fix: report it, tied to the API's trace.
        if (!(err instanceof ApiError) || err.status >= 500) reportError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  if (who === null) return <main aria-busy="true" />;
  if (!who.authenticated) {
    return (
      <main>
        <h1>Hello</h1>
        {error && <p role="alert">{error}</p>}
        <button type="button" onClick={auth.signIn}>
          Sign in
        </button>
      </main>
    );
  }

  return (
    <main>
      <header>
        <span>Signed in as {who.name ?? who.sub}</span>
        <button type="button" onClick={() => void auth.signOut()}>
          Sign out
        </button>
      </header>
      <h1>Hello</h1>
      <form onSubmit={(e) => void submit(e)}>
        <label htmlFor="name">Your name</label>
        <input
          id="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          required
          maxLength={100}
        />
        <button type="submit" disabled={busy || !name.trim()}>
          Greet me
        </button>
      </form>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {chat && (
        <Chat
          chat={chat}
          signedOut={() => {
            setWho({ authenticated: false });
          }}
        />
      )}
    </main>
  );
}
