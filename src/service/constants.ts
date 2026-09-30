// The only CriticalityFormula and ScoreModel this phase's data tree defines — fixed by the
// real files under data/core/, not caller-configurable (see criticality-weights.json,
// scoring-model.json). AGENT_IDENTITY is this single-agent phase's one fixed attribution
// string, applied everywhere a person/agent identity is recorded (evidence.capturedBy,
// finding.priority.assignedBy, controlAssessment.owner/assessedBy) — see spec §8.
export const CRITICALITY_FORMULA_ID = "CRIT-DEFAULT";
export const SCORE_MODEL_ID = "USSVS-SCORE-DEFAULT";
export const AGENT_IDENTITY = "csi-mcp-agent";
