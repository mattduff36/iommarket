export type FinaliseModeKey = "finalise" | "finalise-full" | "fap" | "ffap";

export type FinaliseTaskKey = "typecheck" | "test-run" | "lint" | "build";

export interface FinaliseOptions {
  full: boolean;
  push: boolean;
  dryRun: boolean;
  help: boolean;
}

export interface FinaliseChangedFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface FinaliseChangeSummary {
  commitMessage: string;
  fileCount: number;
  areas: string[];
  schemaFiles: string[];
  secretFiles: string[];
}

export const FINALISE_CONTRACT = "iommarket-finalise-v1";
