import { z } from 'zod';

/*
 * Domain contracts shared by the graph, workers and web server. Anything read from disk, a child
 * process, an agent or the network is declared as a schema here and parsed from `unknown`.
 * Persisted objects use loose schemas so jobs saved by earlier builds keep loading unchanged.
 */

export const providerSchema = z.enum(['codex', 'claude']);
export type Provider = z.infer<typeof providerSchema>;

export const musicModeSchema = z.enum(['original', 'library', 'silent']);
export type MusicMode = z.infer<typeof musicModeSchema>;

export const claimModeSchema = z.enum(['exact', 'semantic']);
export type ClaimMode = z.infer<typeof claimModeSchema>;

export const profileIdSchema = z.enum(['product', 'motion-studio']);
export type ProfileId = z.infer<typeof profileIdSchema>;

/** Input to one film run. Written to `graph-input.json` (with the audio directory redacted). */
export interface FilmInput {
  websiteUrl: string | null;
  repositoryUrl: string | null;
  goal?: string | undefined;
  repositoryName?: string | undefined;
  profile?: string | undefined;
  claimMode?: ClaimMode | undefined;
  audioDir?: string | null | undefined;
  musicMode?: MusicMode | undefined;
  assetDir?: string | null | undefined;
  provider?: Provider | undefined;
  model?: string | undefined;
  effort?: string | undefined;
  resumePlan?: boolean | undefined;
  resumeComposition?: boolean | undefined;
}

const nullableText = z.string().nullish();

export const sourceManifestSchema = z.looseObject({
  capturedAt: z.string().optional(),
  goal: z.string().optional(),
  website: z.looseObject({
    url: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    capturedSourceSha256: z.string().optional(),
    brandPage: z.string().optional(),
    brandAssets: z.number().optional(),
    captureMethod: z.string().optional(),
    htmlBytes: z.number().optional(),
    cssFiles: z.number().optional(),
    contextStyleguide: z.looseObject({
      creditsUsed: z.number().nullish(),
      localCache: z.boolean().nullish(),
      upstreamCacheStatus: nullableText,
      requestId: nullableText,
    }).optional(),
  }).nullish(),
  repository: z.looseObject({
    url: z.string().optional(),
    kind: z.string().optional(),
    clone: z.string().optional(),
    commit: z.string().optional(),
    snapshotSha256: z.string().optional(),
    files: z.number().optional(),
    bytes: z.number().optional(),
    workspacePath: z.string().optional(),
  }).nullish(),
  warnings: z.array(z.string()).optional(),
});
export type SourceManifest = z.infer<typeof sourceManifestSchema>;

/** Plan data is written by an agent, so it is a bag of `unknown` until the plan gate narrows it. */
export const planDataSchema = z.record(z.string(), z.unknown());
export type PlanData = z.infer<typeof planDataSchema>;

// Provider usage is informational, so a field of an unexpected type is dropped rather than failing the claim.
const claimUsageSchema = z.looseObject({
  input_tokens: z.number().optional().catch(undefined),
  output_tokens: z.number().optional().catch(undefined),
  cost: z.number().optional().catch(undefined),
}).nullish().catch(null);

export const claimDecisionSchema = z.looseObject({
  probabilitySupported: z.number(),
  model: z.string().nullish().catch(undefined),
  usage: claimUsageSchema,
});
export type ClaimDecision = z.infer<typeof claimDecisionSchema>;

export const claimEvaluationSchema = claimDecisionSchema.extend({ claim: z.string(), sourcePath: z.string() });
export type ClaimEvaluation = z.infer<typeof claimEvaluationSchema>;

export const planGateSchema = z.looseObject({
  data: planDataSchema,
  issues: z.array(z.string()),
  evaluated: z.array(claimEvaluationSchema),
  passed: z.boolean(),
  thresholdExperimental: z.boolean().optional(),
  uncertainClaims: z.array(z.string()).optional(),
  cacheKey: z.string().optional(),
});
export type PlanGate = z.infer<typeof planGateSchema>;

export const audioCatalogSchema = z.looseObject({
  sourceKind: z.enum(['none', 'original', 'user', 'bundled']),
  tracks: z.array(z.looseObject({
    id: z.string(),
    file: z.string(),
    title: z.string(),
    character: z.string(),
    author: z.string().optional(),
    license: z.string().optional(),
    sourceUrl: z.string().optional(),
  })),
});
export type AudioCatalog = z.infer<typeof audioCatalogSchema>;

export interface StagedAudio {
  choice: string;
  title?: string | null;
  author?: string | null;
  license?: string | null;
  sourceUrl?: string | null;
  source?: string | null;
  destination?: string;
}

export const checkResultSchema = z.looseObject({
  passed: z.boolean(),
  code: z.number().nullable(),
  autoFixes: z.array(z.unknown()),
  findings: z.array(z.string()),
  output: z.string(),
  error: z.string(),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

export const checkedCompositionSchema = z.looseObject({
  passed: z.boolean(),
  composition: z.string(),
  sha256: z.string(),
  checkedAt: z.string().optional(),
});

export const renderHandoffSchema = z.looseObject({
  composition: z.string(),
  output: z.string(),
  posterAtSeconds: z.number(),
});
export type RenderHandoff = z.infer<typeof renderHandoffSchema>;

export const renderReportSchema = z.looseObject({
  output: z.string(),
  durationSeconds: z.number(),
  hasAudio: z.boolean().default(false),
  poster: z.string().optional(),
  bytes: z.number().optional(),
  video: z.looseObject({ width: z.number().optional(), height: z.number().optional() }).optional(),
  audioLevel: z.unknown().optional(),
  audioFallback: z.boolean().optional(),
  audioSource: z.string().nullish(),
});
export type RenderReport = z.infer<typeof renderReportSchema>;

export const reviewResultSchema = z.looseObject({
  status: z.enum(['reported', 'unreviewed']),
  report: z.string(),
  contactSheet: z.string().nullish(),
  reason: z.string().optional(),
});
export type ReviewResult = z.infer<typeof reviewResultSchema>;

export const graphEventSchema = z.looseObject({
  at: z.string().optional(),
  node: z.string(),
  state: z.string(),
  seconds: z.number().optional(),
  outcome: z.string().optional(),
  detail: z.string().nullish(),
  error: z.string().optional(),
  attempt: z.number().optional(),
  reuse: z.looseObject({
    source: z.boolean().optional(),
    plan: z.boolean().optional(),
    composition: z.boolean().optional(),
  }).optional(),
});
export type GraphEvent = z.infer<typeof graphEventSchema>;

export const jobStateSchema = z.enum(['running', 'failed', 'complete']);

export const webJobSchema = z.looseObject({
  id: z.string(),
  createdAt: z.string().optional(),
  state: jobStateSchema,
  input: z.looseObject({
    websiteUrl: z.string().nullish(),
    repositoryUrl: z.string().nullish(),
    repositoryName: z.string().optional(),
    goal: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    musicMode: z.string().optional(),
  }),
  profile: z.string().optional(),
  claimMode: z.string().optional(),
  attempt: z.number().optional(),
  pid: z.number().nullish(),
  error: z.string().nullish(),
  startedAt: z.string().nullish(),
  finishedAt: z.string().nullish(),
});
export type WebJob = z.infer<typeof webJobSchema>;

export const graphInputSchema = z.looseObject({
  profile: z.string().optional().catch(undefined),
  claimMode: z.string().optional().catch(undefined),
  model: z.string().optional().catch(undefined),
});

export const graphReportSchema = z.looseObject({
  manifest: sourceManifestSchema.optional(),
  plan: planDataSchema.optional(),
  music: z.looseObject({
    choice: z.string().optional(),
    title: z.string().nullish(),
    author: z.string().nullish(),
    license: z.string().nullish(),
    sourceUrl: z.string().nullish(),
  }).nullish(),
  claimDecisions: z.array(claimEvaluationSchema).optional(),
  render: renderReportSchema.optional(),
  review: reviewResultSchema.optional(),
});
export type GraphReport = z.infer<typeof graphReportSchema>;

export const ffprobeSchema = z.looseObject({
  streams: z.array(z.looseObject({
    codec_type: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    avg_frame_rate: z.string().optional(),
    channels: z.number().optional(),
    sample_rate: z.string().optional(),
  })).optional(),
  format: z.looseObject({ duration: z.string().optional() }).optional(),
});
export type FfprobeResult = z.infer<typeof ffprobeSchema>;

export interface LoudnessReading {
  loudnessLufs: number;
  truePeakDbfs: number;
}
