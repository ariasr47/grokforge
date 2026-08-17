import { compileFixedInspection } from "./inspection-grammar.js";
import { matchTrustedCommandClass } from "./trusted-command-match.js";

export type AuthorizationResult = {
  decision: "auto" | "decision" | "refuse";
  automaticEligibility:
    | "read"
    | "fixed_inspection"
    | "text_edit"
    | "bypass"
    | "trusted_command_class"
    | "not_eligible";
  reason?: string;
};

export type AuthorizationRequest = {
  kind: "read" | "list" | "search" | "inspection" | "text_edit" | "shell" | string;
  path?: string;
  regularText?: boolean;
  exists?: boolean;
  command?: string;
};

export class AuthorizationBroker {
  authorize(
    request: AuthorizationRequest,
    context: {
      mode: "review" | "trusted_workspace" | "bypass_permissions";
      confined?: boolean;
      inspection?: string;
      trustedCommandClasses?: readonly string[];
    },
  ): AuthorizationResult {
    if (
      (request.kind === "read" || request.kind === "list" || request.kind === "search") &&
      context.confined !== false
    ) {
      return { decision: "auto", automaticEligibility: "read" };
    }
    if (
      request.kind === "inspection" &&
      context.confined === false &&
      context.mode !== "bypass_permissions"
    ) {
      return {
        decision: "refuse",
        automaticEligibility: "not_eligible",
        reason: "outside_workspace",
      };
    }
    if (request.kind === "inspection" && context.inspection && compileFixedInspection(context.inspection)) {
      return {
        decision: "auto",
        automaticEligibility:
          context.mode === "bypass_permissions" ? "bypass" : "fixed_inspection",
      };
    }
    if (
      request.kind === "text_edit" &&
      request.regularText &&
      context.mode === "trusted_workspace"
    ) {
      return { decision: "auto", automaticEligibility: "text_edit" };
    }
    if (context.mode === "bypass_permissions") {
      return { decision: "auto", automaticEligibility: "bypass" };
    }
    if (
      request.kind === "shell" &&
      context.mode === "trusted_workspace" &&
      typeof request.command === "string"
    ) {
      const matched = matchTrustedCommandClass(
        request.command,
        new Set(context.trustedCommandClasses ?? []),
      );
      if (matched) {
        return { decision: "auto", automaticEligibility: "trusted_command_class" };
      }
    }
    if (context.confined === false && request.kind !== "shell") {
      return {
        decision: "refuse",
        automaticEligibility: "not_eligible",
        reason: "outside_workspace",
      };
    }
    return { decision: "decision", automaticEligibility: "not_eligible" };
  }
}
