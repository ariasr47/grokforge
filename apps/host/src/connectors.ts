/**
 * Grok connectors honesty (Settings). Not a Forge MCP host and not a paste catalog.
 * Linked vs available is unknown until xAI vouches a list API.
 */

export const GROK_CONNECTORS_MANAGE_URL = "https://grok.com/connectors";

/** Names from xAI docs — documentation, not this account. */
export const GROK_CONNECTOR_CATALOG_DOCS = [
  "Gmail",
  "Google Calendar",
  "Google Drive",
  "Outlook",
  "Teams",
  "OneDrive",
  "SharePoint",
  "Salesforce",
  "third-party catalog",
  "Custom MCP",
] as const;

export type GrokConnectorsLinkedStatus = "unknown";

export interface GrokConnectorsView {
  linkedStatus: GrokConnectorsLinkedStatus;
  manageUrl: string;
  chatUsesGrokConnectors: false;
  catalogDocs: readonly string[];
}

export function grokConnectorsView(): GrokConnectorsView {
  return {
    linkedStatus: "unknown",
    manageUrl: GROK_CONNECTORS_MANAGE_URL,
    chatUsesGrokConnectors: false,
    catalogDocs: GROK_CONNECTOR_CATALOG_DOCS,
  };
}
