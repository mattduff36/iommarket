const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export const FIXERRORS_NOTE_MAX_LENGTH = 500;
export const FIXERRORS_INVESTIGATION_NOTE = "fixerrors acknowledged for investigation";

export function sanitizeEvidence(evidence: string): string {
  const trimmed = evidence.trim();
  if (!trimmed || EMAIL_RE.test(trimmed)) {
    throw new Error("Resolution evidence must be present and must not contain an email address");
  }
  return trimmed.slice(0, FIXERRORS_NOTE_MAX_LENGTH);
}

export function sanitizeNextStep(nextStep: string): string {
  const trimmed = nextStep.trim();
  if (!trimmed || trimmed.length > FIXERRORS_NOTE_MAX_LENGTH || EMAIL_RE.test(trimmed)) {
    throw new Error("Next step must be 1-500 characters and must not contain an email address");
  }
  return trimmed;
}

export function resolutionNote(runId: string, evidence: string): string {
  const prefix = `fixerrors run=${runId} evidence=`;
  return `${prefix}${evidence.slice(0, Math.max(0, FIXERRORS_NOTE_MAX_LENGTH - prefix.length))}`;
}
