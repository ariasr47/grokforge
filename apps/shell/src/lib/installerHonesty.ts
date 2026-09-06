import { isTauri } from "./api";

/** Dual-source SHA voucher on shell `buildInfo` (PLAN D1). */
export type InstallerShaVoucher =
  | { status: "pending" }
  | { status: "live"; value: string | null }
  | { status: "unreachable" };

export const WELCOME_EXPECTED_WARNING =
  "Windows may show an unknown-publisher or SmartScreen warning. That is expected — this Windows installer is not Authenticode-signed.";

export const SHA_LABEL = "Installer SHA-256:";

export const SHA_LOADING = "Loading installer SHA-256…";

export const WELCOME_SHA_UNAVAILABLE = "Installer SHA-256 unavailable.";

export const WELCOME_SHA_UNAVAILABLE_HINT = "Find it in Settings when available.";

export const SETTINGS_SHA_UNAVAILABLE = "Installer SHA-256 unavailable";

export const SHA_UNREACHABLE = "Installer SHA-256 unreachable — host is offline.";

export const WELCOME_SHA_COMPARE_HINT =
  "Compare with the SHA-256 in the release notes for this version.";

export const SETTINGS_UNSIGNED_LINE =
  "This Windows installer is not Authenticode-signed. Windows may show an unknown-publisher or SmartScreen warning.";

export const SHA_TITLE =
  "SHA-256 of the Forge Windows installer for this app version. Compare it to the release notes — Forge does not claim Windows verified this publisher.";

export type InstallerShaPaint = {
  statusText: string;
  hex: string | null;
  hint: string | null;
};

export function paintInstallerSha(
  voucher: InstallerShaVoucher,
  surface: "welcome" | "settings",
): InstallerShaPaint {
  if (voucher.status === "pending") {
    return { statusText: SHA_LOADING, hex: null, hint: null };
  }
  if (voucher.status === "unreachable") {
    return { statusText: SHA_UNREACHABLE, hex: null, hint: null };
  }
  if (typeof voucher.value === "string") {
    return {
      statusText: SHA_LABEL,
      hex: voucher.value,
      hint: surface === "welcome" ? WELCOME_SHA_COMPARE_HINT : null,
    };
  }
  if (surface === "welcome") {
    return {
      statusText: WELCOME_SHA_UNAVAILABLE,
      hex: null,
      hint: WELCOME_SHA_UNAVAILABLE_HINT,
    };
  }
  return { statusText: SETTINGS_SHA_UNAVAILABLE, hex: null, hint: null };
}

export function shaSettingsLabel(
  voucher: InstallerShaVoucher | null | undefined,
): string {
  return paintInstallerSha(voucher ?? { status: "pending" }, "settings").statusText;
}

const BANNED_POSITIVE_SUBSTRINGS = [
  "verified publisher",
  "this build is signed",
  "this build is authenticode-signed",
  "windows trusts this",
  "safe installer",
  "secure installer",
  "microsoft approved",
];

export function assertNoBannedPositiveTrustClaims(text: string): void {
  const lower = text.toLowerCase();
  for (const banned of BANNED_POSITIVE_SUBSTRINGS) {
    if (lower.includes(banned)) {
      throw new Error(`banned positive trust claim: ${banned}`);
    }
  }
  const stripped = lower
    .replace(/not authenticode-signed/g, "")
    .replace(/\bunsigned\b/g, "");
  if (/\bthis build is signed\b/.test(stripped)) {
    throw new Error("banned positive trust claim: this build is signed");
  }
  if (/\bauthenticode-signed\b/.test(stripped) || /\bcode-signed\b/.test(stripped)) {
    throw new Error("banned positive trust claim: signed as a positive claim about this build");
  }
}

export function isPackagedWindowsInstallerSession(opts?: {
  tauri?: boolean;
  userAgent?: string;
}): boolean {
  const tauri = opts?.tauri ?? isTauri();
  const ua =
    opts?.userAgent ??
    (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return tauri && /windows/i.test(ua);
}
