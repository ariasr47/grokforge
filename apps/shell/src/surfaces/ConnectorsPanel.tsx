import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/Button";
import {
  api,
  type ConnectorInfo,
  type ConnectorStatus,
} from "../lib/api";

interface Props {
  onUseSample?: (text: string) => void;
  onOpenChat?: () => void;
}

const STATUS_LABEL: Record<ConnectorStatus, string> = {
  live: "Live",
  configured: "Token saved",
  paste_workflow: "Paste workflow",
  planned: "Planned",
};

export function ConnectorsPanel({ onUseSample, onOpenChat }: Props) {
  const [list, setList] = useState<ConnectorInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tokenDrafts, setTokenDrafts] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>("gmail");

  const reload = useCallback(async () => {
    try {
      const r = await api.listConnectors();
      setList(r.connectors);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveToken = async (id: string) => {
    setBusyId(id);
    try {
      const raw = tokenDrafts[id] ?? "";
      const r = await api.setConnectorToken(id, raw.trim() || null);
      setList(r.connectors);
      setTokenDrafts((d) => ({ ...d, [id]: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const runTest = async (id: string) => {
    setBusyId(id);
    try {
      const r = await api.testConnector(id);
      setList(r.connectors);
      if (!r.ok) setError(r.message);
      else setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="connectors-panel" aria-label="Connectors">
      <h2 className="connectors-title">Connectors</h2>
      <p className="lead connectors-lead">
        Link work tools when available. Today most apps use a{" "}
        <strong>paste workflow</strong> (safe, no extra login). Notion can use an
        integration secret for a live smoke test. Gmail OAuth is next — we can
        test drafts on your accounts via paste now.
      </p>
      {error && (
        <div className="callout" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      <ul className="connectors-list">
        {list.map((c) => {
          const open = expanded === c.id;
          return (
            <li key={c.id} className={`connector-card status-${c.status}`}>
              <button
                type="button"
                className="connector-head"
                onClick={() => setExpanded(open ? null : c.id)}
                aria-expanded={open}
              >
                <span className="connector-name">{c.name}</span>
                <span className={`connector-badge badge-${c.status}`}>
                  {STATUS_LABEL[c.status]}
                </span>
              </button>
              {open && (
                <div className="connector-body">
                  <p className="connector-desc">{c.description}</p>
                  <p className="hint">
                    <strong>Use today:</strong> {c.howToday}
                  </p>
                  {c.lastTestMessage && (
                    <p
                      className={`hint ${c.lastTestOk ? "ok" : "err"}`}
                      role="status"
                    >
                      Last test: {c.lastTestMessage}
                    </p>
                  )}
                  {c.tokenConfigurable && (
                    <div className="field" style={{ marginTop: 10 }}>
                      <label htmlFor={`tok-${c.id}`}>
                        {c.tokenLabel || "API token"}
                        {c.hasToken ? " · saved" : ""}
                      </label>
                      <input
                        id={`tok-${c.id}`}
                        type="password"
                        autoComplete="off"
                        placeholder={c.hasToken ? "•••••••• (enter new to replace)" : ""}
                        value={tokenDrafts[c.id] ?? ""}
                        onChange={(e) =>
                          setTokenDrafts((d) => ({
                            ...d,
                            [c.id]: e.target.value,
                          }))
                        }
                      />
                      <div className="row" style={{ marginTop: 8 }}>
                        <Button
                          disabled={busyId === c.id}
                          onClick={() => void saveToken(c.id)}
                        >
                          Save token
                        </Button>
                        {c.hasToken && (
                          <Button
                            variant="ghost"
                            disabled={busyId === c.id}
                            onClick={() => {
                              setTokenDrafts((d) => ({ ...d, [c.id]: "" }));
                              void api
                                .setConnectorToken(c.id, null)
                                .then((r) => setList(r.connectors));
                            }}
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="row" style={{ marginTop: 10, gap: 8 }}>
                    <Button
                      disabled={busyId === c.id}
                      onClick={() => void runTest(c.id)}
                    >
                      {busyId === c.id ? "Testing…" : "Test"}
                    </Button>
                    {onUseSample && (
                      <Button
                        variant="primary"
                        onClick={() => {
                          onUseSample(c.samplePrompt);
                          onOpenChat?.();
                        }}
                      >
                        Try in Chat
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
