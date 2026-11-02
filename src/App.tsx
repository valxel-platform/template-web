import { useState, type SyntheticEvent } from "react";
import { ApiError, type ApiClient } from "./api/client";

export function App({ api }: { api: ApiClient }) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setMessage((await api.greeting(name.trim())).message);
    } catch (err) {
      setMessage(null);
      setError(err instanceof ApiError ? err.detail : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
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
    </main>
  );
}
