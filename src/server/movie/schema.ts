export const FINISHED_MOVIE_DOCUMENT_SCHEMA_VERSION = "1.0";

export type FinishedMovieDocument = {
  schemaVersion: typeof FINISHED_MOVIE_DOCUMENT_SCHEMA_VERSION;
  title: string;
  source: {
    renderJobId: string;
    timelineVersion?: number;
  };
  durationMs?: number;
  mimeType?: string;
};

export type MovieKeepInput = {
  renderJobId?: string;
  title?: string;
  /** When true, enqueue LIBRARY_KEEP and return 202. Local/fast copies may stay sync. */
  async?: boolean;
};

export type MovieKeepAccepted = {
  jobId: string;
  status: "ACCEPTED";
};

export type MovieAvailability = {
  canKeep: boolean;
  storageWritable: boolean;
  hasSucceededRender: boolean;
};

export type FinishedMovieView = {
  id: string;
  projectId: string;
  renderJobId: string;
  title: string;
  status: string;
  durationMs: number | null;
  mimeType: string | null;
  byteSize: number | null;
  checksum: string | null;
  keptAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MovieJobStatusView = {
  jobId: string;
  movieId: string | null;
  status: string;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export function libraryStorageKey(projectId: string, movieId: string, ext = "mp4") {
  return `projects/${projectId}/movies/${movieId}/output.${ext}`;
}
