/** Host-vouched list-auto only: executed shell with Trusted command-class eligibility. */
export function isListAutoExecuted(a: {
  execution?: string | null;
  automaticEligibility?: string | null;
  autoApplied?: boolean | null;
}): boolean {
  return (
    a.execution === "executed" &&
    a.automaticEligibility === "trusted_command_class" &&
    a.autoApplied === true
  );
}
