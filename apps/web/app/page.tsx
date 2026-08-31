"use client";

import { useEffect, useRef, useState } from "react";

interface Person {
  id: string;
  displayName: string;
  role: "OWNER" | "EMPLOYEE" | "SYSTEM";
  businessName: string;
}

interface Bubble {
  id: string;
  side: "in" | "out";
  text: string;
  isError?: boolean;
}

interface OutboundPayload {
  text: string;
  quickReplies?: string[];
}

/** Phrases the mock provider recognises, offered so the harness is usable. */
const SUGGESTIONS = [
  "show my record",
  "list the team",
  "update my emergency contact name to Dana Vega",
];

export default function ChatSimulator() {
  const [people, setPeople] = useState<Person[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [provider, setProvider] = useState<string>("…");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/users");
        const data = (await response.json()) as {
          users?: Person[];
          provider?: string;
          error?: string;
          hint?: string;
        };
        if (cancelled) return;

        if (!response.ok) {
          setLoadError(data.hint ?? data.error ?? "Could not load users.");
          return;
        }
        setPeople(data.users ?? []);
        setProvider(data.provider ?? "unknown");
        setActiveId(data.users?.[0]?.id ?? null);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Could not reach the API.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [bubbles, busy]);

  const active = people.find((person) => person.id === activeId) ?? null;

  function switchPerson(id: string) {
    if (id === activeId) return;
    setActiveId(id);
    // Each person has their own thread on the server; clearing the view keeps
    // the two from looking like one conversation.
    setBubbles([]);
    setQuickReplies([]);
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (trimmed === "" || !activeId || busy) return;

    setDraft("");
    setQuickReplies([]);
    setBubbles((current) => [
      ...current,
      { id: `${Date.now()}-out`, side: "out", text: trimmed },
    ]);
    setBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: activeId, message: trimmed }),
      });

      const data = (await response.json()) as {
        messages?: OutboundPayload[];
        error?: string;
      };

      if (!response.ok) {
        setBubbles((current) => [
          ...current,
          {
            id: `${Date.now()}-err`,
            side: "in",
            text: data.error ?? "Something went wrong.",
            isError: true,
          },
        ]);
        return;
      }

      const replies = data.messages ?? [];
      setBubbles((current) => [
        ...current,
        ...replies.map((reply, index) => ({
          id: `${Date.now()}-in-${index}`,
          side: "in" as const,
          text: reply.text,
        })),
      ]);
      setQuickReplies(replies.at(-1)?.quickReplies ?? []);
    } catch (error) {
      setBubbles((current) => [
        ...current,
        {
          id: `${Date.now()}-err`,
          side: "in",
          text: error instanceof Error ? error.message : "Network error.",
          isError: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>mycrew</h1>
          <span>simulator</span>
        </div>
        <p className="tagline">
          Stand-in for WhatsApp. Messages take the same path they will in
          production.
        </p>

        <p className="section-label">Chat as</p>
        <div className="person-list">
          {people.map((person) => (
            <button
              key={person.id}
              type="button"
              className="person"
              aria-pressed={person.id === activeId}
              onClick={() => switchPerson(person.id)}
            >
              <span className="avatar">{initials(person.displayName)}</span>
              <span className="person-meta">
                <span className="person-name">{person.displayName}</span>
                <span className="person-role">
                  {person.role === "OWNER" ? "Owner" : "Staff"}
                </span>
              </span>
            </button>
          ))}
          {people.length === 0 && !loadError && (
            <p className="hint">Loading people…</p>
          )}
        </div>

        <p className="section-label">Language model</p>
        <span className="provider-badge">
          <span className={`dot ${provider === "mock" ? "mock" : ""}`} />
          {provider}
        </span>
        {provider === "mock" && (
          <p className="hint">
            Keyword matching only. Set <code>MYCREW_LLM_PROVIDER=anthropic</code>{" "}
            and <code>ANTHROPIC_API_KEY</code> for real conversation.
          </p>
        )}
        {loadError && <p className="hint">{loadError}</p>}
      </aside>

      <main className="chat">
        <header className="chat-header">
          <div>
            <h2>{active ? active.businessName : "No account"}</h2>
            <p>
              {active
                ? `Talking to ${active.displayName}`
                : "Seed the database to begin"}
            </p>
          </div>
        </header>

        <div className="transcript" ref={transcriptRef}>
          {bubbles.length === 0 ? (
            <p className="empty">
              {loadError
                ? "Fix the database connection, then reload."
                : "Send a message to start. Try one of the suggestions below."}
            </p>
          ) : (
            bubbles.map((bubble) => (
              <div
                key={bubble.id}
                className={`row ${bubble.side}${bubble.isError ? " error" : ""}`}
              >
                <div className="bubble">{bubble.text}</div>
              </div>
            ))
          )}
          {busy && (
            <div className="row in">
              <div className="bubble">
                <span className="typing">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            </div>
          )}
        </div>

        <div>
          {quickReplies.length > 0 && (
            <div className="quick-replies">
              {quickReplies.map((reply) => (
                <button
                  key={reply}
                  type="button"
                  className="quick-reply"
                  disabled={busy}
                  onClick={() => void send(reply)}
                >
                  {reply}
                </button>
              ))}
            </div>
          )}

          {quickReplies.length === 0 && bubbles.length === 0 && (
            <div className="suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="suggestion"
                  disabled={busy || !activeId}
                  onClick={() => void send(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send(draft);
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                active ? `Message as ${active.displayName}…` : "Seed first…"
              }
              disabled={busy || !activeId}
              autoComplete="off"
            />
            <button type="submit" disabled={busy || draft.trim() === ""}>
              Send
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
