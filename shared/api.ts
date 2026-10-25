/*
 * Wire types for the local web API, shared by the server and the browser bundle.
 * Type-only: this module must stay free of Node and runtime imports so the client can import it.
 */

export type ProviderId = 'codex' | 'claude';
export type MusicMode = 'original' | 'library' | 'silent';
export type JobState = 'running' | 'failed' | 'complete' | 'interrupted';
export type StageStatus = 'running' | 'complete' | 'failed';

export interface ProviderStatus {
  ready: boolean;
  authType?: string | undefined;
  detail: string;
}

export interface ConfigResponse {
  name: string;
  mode: 'local';
  model: string;
  profile: string;
  providers: Record<ProviderId, ProviderStatus>;
  renderTools: { ffmpeg: boolean; ffprobe: boolean };
}

export type LoginState = 'waiting' | 'connected' | 'failed' | 'cancelled';

export interface LoginSession {
  id: string;
  provider: ProviderId;
  state: LoginState;
  message: string;
  url?: string;
}

export interface ErrorResponse { error: string }

export interface UploadCreated { id: string; name: string }

export interface CreateJobRequest {
  websiteUrl?: string;
  repositoryUrl?: string;
  goal?: string;
  provider?: string;
  model?: string;
  musicMode?: string;
  uploadId?: string;
}

export interface JobInputView {
  websiteUrl?: string | null | undefined;
  repositoryUrl?: string | null | undefined;
  repositoryName?: string | undefined;
  goal?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  musicMode?: string | undefined;
}

export interface JobSummary {
  id: string;
  createdAt: string | undefined;
  finishedAt: string | null;
  state: JobState;
  stage: string;
  attempt: number;
  filmReady: boolean;
  hasAudio: boolean;
  resumeEligible: boolean;
  websiteUrl: string;
  repositoryUrl: string;
  repositoryName: string;
  provider: string;
  model: string;
}

export interface JobsResponse { jobs: JobSummary[] }

export interface JobEventView {
  at?: string | undefined;
  node: string;
  state: string;
  seconds?: number | undefined;
  outcome?: string | undefined;
  detail?: string | null | undefined;
  error?: string | undefined;
  attempt?: number | undefined;
  reuse?: { source?: boolean | undefined; plan?: boolean | undefined; composition?: boolean | undefined } | undefined;
}

export interface JobResume {
  eligible: boolean;
  source: boolean;
  plan: boolean;
  composition: boolean;
  from: string;
}

export interface JobStatus {
  id: string;
  input: JobInputView;
  createdAt: string | undefined;
  finishedAt: string | null;
  attempt: number;
  state: JobState;
  stage: string;
  stages: Record<string, StageStatus>;
  error: string | null;
  finding: string | null | undefined;
  resume: JobResume;
  events: JobEventView[];
  activity: { message: string; at: string } | null;
  activeSince: string | null;
  phases: { source: boolean; story: boolean; composition: boolean; render: boolean };
  filmReady: boolean;
  music: { choice?: string | undefined; title?: string | null | undefined; author?: string | null | undefined; license?: string | null | undefined; sourceUrl?: string | null | undefined } | null;
  musicChoice: string | null;
  review: { status: string; report: string; contactSheet?: string | null | undefined } | null;
  render: { durationSeconds: number; width: number | undefined; height: number | undefined; hasAudio: boolean; audioSource: string | null; audioFallback: boolean } | null;
}
