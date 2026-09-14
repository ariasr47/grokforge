import { useCallback, useEffect, useState } from "react";
import {
  api,
  GROK_CONNECTORS_MANAGE_URL,
  type GrokConnectorsView,
} from "../lib/api";

interface Props {
  signedIn: boolean;
}

export function ConnectorsPanel({ signedIn }: Props) {
  const [view, setView] = useState<GrokConnectorsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await api.grokConnectors();
      setView(r);
      setError(null);
    } catch (e) {
      setView(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const manageUrl =
    view?.manageUrl?.startsWith("https://grok.com/")
      ? view.manageUrl
      : GROK_CONNECTORS_MANAGE_URL;
  const catalogDocs = view?.catalogDocs ?? [];

  return (
    <section className="connectors-panel" aria-label="Grok connectors">
      <h2 className="connectors-title">Grok connectors</h2>
      <p className="lead connectors-lead">
        {signedIn
          ? "These live on your Grok account at grok.com. Forge cannot see which ones are linked. Forge Chat does not use them yet."
          : "Connector links still live on grok.com. Signing into Forge does not reveal them, and Forge Chat still would not use them."}
      </p>
      {error && (
        <div className="callout" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div className="connectors-absent" role="status">
        <strong>Linked status: unknown.</strong>{" "}
        {signedIn
          ? "There is no vouched API for this account’s connectors. Open grok.com to see what’s connected."
          : "Sign in with Grok to use this account in Forge. Manage connectors on grok.com either way."}
      </div>
      <div className="connectors-cta">
        <a
          className="btn primary"
          href={manageUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open grok.com/connectors
        </a>
      </div>
      {signedIn && catalogDocs.length > 0 ? (
        <p className="connectors-catalog-note">
          Grok documents {catalogDocs.join(", ")}. Browse and connect on grok.com
          — this list is documentation, not your account.
        </p>
      ) : null}
    </section>
  );
}
