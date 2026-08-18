export type RunState = "admitted"|"running"|"waiting_for_decision"|"recovering"|"cancelling"|"terminal";
export type TerminalKind = "answered"|"failed"|"cancelled";
export type FailureCode = "missing_final_answer"|"provider_unavailable"|"provider_liveness_exhausted"|"execution_owner_lost"|"interrupted"|"journal_unavailable"|"configuration_required"|"authentication_required"|"edit_conflict"|"internal_error";
export type RecoveryAction = "retry_prompt"|"open_settings"|"reconnect"|"export_diagnostics"|null;
export type WorkspacePolicyMode = "review"|"trusted_workspace";
export type EffectivePermissionMode = WorkspacePolicyMode|"bypass_permissions";
export type PolicySource = "default"|"saved"|"fallback"|"session_bypass";
export type PolicyFallbackReason = "missing"|"invalid"|"unreadable"|null;
export type PolicySnapshot = { workspace:string; storedMode:WorkspacePolicyMode|null; effectiveMode:EffectivePermissionMode; source:PolicySource; revision:string; fallbackReason:PolicyFallbackReason; snapshottedAt:string };
export type ModelSnapshot = { requestedModel:string; appliedModel:string; selectionProvenance:"inherited"|"explicit" };
export type FailureView = { code:FailureCode; message:string; retryable:boolean; recoveryAction:RecoveryAction }|null;
export type ExecutionPhase = "plan" | "execute";
export type PlanProposedMember = {
  summary: string;
  path: string | null;
};
export type PlanRecordStatus =
  | "exploring"
  | "ready"
  | "accepted"
  | "kept_planning"
  | "superseded"
  | "cancelled"
  | "failed";
export type PlanRecord = {
  runId: string;
  sessionId: string;
  connectionGeneration: number;
  status: PlanRecordStatus;
  body: string | null;
  proposedMembers: PlanProposedMember[];
  policy: PolicySnapshot;
  executionPhase: "plan";
};
export type RunSnapshot = { sessionId:string; runId:string; connectionGeneration:number; state:RunState; acceptedPrompt:string; admittedAt:string; updatedAt:string; lastEventSeq:number; policy:PolicySnapshot; model:ModelSnapshot; terminalKind:TerminalKind|null; finalAnswer:string|null; answerVouched:boolean; failure:FailureView; executionPhase:ExecutionPhase };
export type DecisionKind = "permission"|"diff"|"recovery_confirmation"|"plan";
export type DecisionRequest = { requestId:string; invocationId:string; kind:DecisionKind; status:"pending"|"accepted"|"declined"|"expired"|"kept_planning"|"cancelled"; title:string; detail:string; expiresAt:string|null; policy:PolicySnapshot };
export type ActivityRecord = { activityId:string; invocationId:string; name:string; lifecycle:"pending"|"terminal"; execution:null|"executed"|"not_executed"; status:"running"|"succeeded"|"failed"|"rejected"; input:unknown; output:unknown|null; error:string|null; diff:string|null; path:string|null; policy:PolicySnapshot; automaticEligibility:"read"|"fixed_inspection"|"text_edit"|"bypass"|"trusted_command_class"|"not_eligible"; autoApplied:boolean; command:string|null; editId:string|null; recovery:null|{kind:"guarded_revert";available:boolean;status:"available"|"pending"|"reverted"|"conflict"|"failed"} };
export type RunEventPayload = {kind:"run_started";run:RunSnapshot}|{kind:"run_state";state:Exclude<RunState,"terminal">;liveness:"provider"|"tool"|"decision"|"background"|"journal_recovery"|null}|{kind:"reasoning_delta";segmentId:string;delta:string}|{kind:"answer_delta";segmentId:string;delta:string}|{kind:"activity_update";activity:ActivityRecord}|{kind:"decision_request";request:DecisionRequest}|{kind:"plan_record";plan:PlanRecord}|{kind:"run_terminal";terminalKind:TerminalKind;finalAnswer:string|null;answerVouched:boolean;failure:FailureView;terminalAt:string};
export type RunEventEnvelope = {schemaVersion:1;type:"run_started"|"run_state"|"reasoning_delta"|"answer_delta"|"activity_update"|"decision_request"|"plan_record"|"run_terminal";sessionId:string;runId:string;eventSeq:number;connectionGeneration:number;occurredAt:string;payload:RunEventPayload};
