import { z } from 'zod';

export const id = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_.:-]+$/);
export const slug = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'] as const;
export const findingSchema = z.object({
  rule: id, severity: z.enum(['error', 'warning']), message: z.string().max(1500),
  path: z.string().max(1000).optional(), line: z.number().int().positive().optional(),
}).strict();
export const policySchema = z.object({
  version: z.number().int().positive().default(1), mode: z.enum(['enforce', 'observe']).default('enforce'),
  blockDatabaseReset: z.boolean().default(true), blockDatabasePush: z.boolean().default(false),
  protectGovernanceFiles: z.boolean().default(true), reviewArchitecture: z.boolean().default(true),
  stopReminder: z.boolean().default(true),
  sourceRules: z.array(z.object({
    id, pathPrefix: z.string().max(500), forbiddenText: z.string().min(1).max(500),
    allowedPathPrefixes: z.array(z.string().min(1).max(500)).max(50).default([]),
    message: z.string().min(1).max(1500),
  }).strict()).max(100).default([]),
}).strict();
export const defaultPolicy = policySchema.parse({});
export const eventSchema = z.object({
  id, sessionId: id, kind: z.enum(events), occurredAt: z.iso.datetime(), turnId: id.optional(),
  toolCallId: id.optional(), tool: z.string().max(200).optional(), prompt: z.string().max(100000).optional(),
  command: z.string().max(16000).optional(), paths: z.array(z.string().max(1000)).max(200).default([]),
  status: z.enum(['observed', 'allowed', 'denied', 'succeeded', 'failed', 'unknown']).default('observed'),
  findings: z.array(findingSchema).max(200).default([]), skillRelease: z.string().max(160).optional(),
  detail: z.string().max(2000).optional(),
}).strict();
export const skillSchema = z.object({slug, version: z.string().min(1).max(80), hash, content: z.string().min(1).max(200000)}).strict();
export const releaseSchema = z.object({version: z.string().min(1).max(80), skills: z.array(skillSchema).max(100), hash}).strict();
export const skillEditSchema=z.object({content:z.string().min(1).max(200000),expectedReleaseHash:hash.nullable(),create:z.boolean()}).strict();
export const skillSyncFileSchema=z.object({path:z.string().regex(/^\.agents\/skills\/(?:project-|lumora-)[a-z0-9-]+\/SKILL\.md$/),localHash:hash.nullable(),remoteHash:hash.nullable(),status:z.enum(['synced','local','conflict','missing'])}).strict();
export const skillSyncReportSchema=z.object({repositoryId:z.uuid(),name:z.string().min(1).max(200),version:z.string().min(1).max(80),releaseHash:hash,files:z.array(skillSyncFileSchema).max(200)}).strict();
export const skillResolutionSchema=z.object({path:skillSyncFileSchema.shape.path,localHash:hash,remoteHash:hash,choice:z.enum(['local','published'])}).strict();
export type SkillResolution=z.infer<typeof skillResolutionSchema>;
export const principalSchema = z.object({
  id, projectId: id, userId: id, name: z.string().min(1).max(120), role: z.enum(['admin', 'observer', 'agent']),
});
export const provisionSchema = principalSchema.omit({id: true, projectId: true}).strict();
export const connectionSchema = z.object({
  version: z.literal(1), projectId: id, serverUrl: z.url(), tokenEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).default('LUMORA_AGENT_TOKEN'),
  policy: policySchema.default(defaultPolicy),
  lumora: z.object({url: z.url(), projectId: id, apiKeyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).default('LUMORA_API_KEY'),
    sessionTokenEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional(), skillSlug: slug.optional(),
  }).strict().optional(),
}).strict();
export const hookSchema = z.object({
  hook_event_name: z.enum(events), session_id: id, cwd: z.string().min(1).max(2000),
  turn_id: id.optional(), tool_use_id: id.optional(), tool_name: z.string().max(200).optional(),
  tool_input: z.unknown().optional(), tool_response: z.unknown().optional(), prompt: z.string().max(100000).optional(),
  stop_hook_active: z.boolean().optional(), source: z.string().optional(),
}).passthrough();
export type Event = z.infer<typeof eventSchema>;
export type Policy = z.infer<typeof policySchema>;
export type Principal = z.infer<typeof principalSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type Release = z.infer<typeof releaseSchema>;
export type Hook = z.infer<typeof hookSchema>;
