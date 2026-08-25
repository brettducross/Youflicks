export const ProjectStatus = {
  DRAFT: "DRAFT",
  INGESTING: "INGESTING",
  ANALYZING: "ANALYZING",
  DIRECTING: "DIRECTING",
  EDITING: "EDITING",
  RENDERING: "RENDERING",
  COMPLETED: "COMPLETED",
  ARCHIVED: "ARCHIVED",
} as const;

export type ProjectStatusValue = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const JobStatus = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;

export type JobStatusValue = (typeof JobStatus)[keyof typeof JobStatus];

export const JobType = {
  MEDIA_ANALYZE: "MEDIA_ANALYZE",
  AI_DIRECT: "AI_DIRECT",
  RENDER: "RENDER",
  PUBLISH: "PUBLISH",
} as const;

export const AnalysisStatus = {
  NOT_ANALYZED: "NOT_ANALYZED",
  QUEUED: "QUEUED",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export type AnalysisStatusValue = (typeof AnalysisStatus)[keyof typeof AnalysisStatus];

export function analysisStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    NOT_ANALYZED: "Not analyzed",
    QUEUED: "Queued",
    PROCESSING: "Analyzing",
    COMPLETED: "Analyzed",
    FAILED: "Analysis failed",
    PENDING: "Queued",
    RUNNING: "Analyzing",
    SUCCEEDED: "Analyzed",
  };
  return labels[status] ?? status;
}

export const PIPELINE_STAGES = [
  { id: "user", label: "User", available: true },
  { id: "project", label: "Project", available: true },
  { id: "media", label: "Media assets", available: true },
  { id: "analysis", label: "Media analysis", available: true },
  { id: "taste", label: "Taste & project intent", available: true },
  { id: "director", label: "AI Director", available: false },
  { id: "story", label: "Story structure", available: false },
  { id: "timeline", label: "Timeline", available: false },
  { id: "render", label: "Rendering", available: false },
  { id: "movie", label: "Finished movie", available: false },
  { id: "credits", label: "Credits & sponsorship", available: true },
  { id: "publish", label: "Publishing", available: false },
] as const;

export function projectStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: "Draft",
    INGESTING: "Ingesting",
    ANALYZING: "Analyzing",
    DIRECTING: "Directing",
    EDITING: "Editing",
    RENDERING: "Rendering",
    COMPLETED: "Completed",
    ARCHIVED: "Archived",
  };
  return labels[status] ?? status;
}
