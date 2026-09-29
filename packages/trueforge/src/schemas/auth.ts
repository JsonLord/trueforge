/** Auth wire schemas. */
import { z } from '@hono/zod-openapi';

export const AuthLoginQuerySchema = z.object({
  return_to: z.string().optional().describe('Same-origin path to land on after authentication.'),
});

export const OAuthCallbackQuerySchema = z.object({
  code: z.string().min(1).optional().describe('Authorization code, present when the user granted consent.'),
  state: z
    .string()
    .min(1)
    .describe('Opaque token; correlates this callback to its pending login. Always present, success or error.'),
  error: z
    .string()
    .optional()
    .describe('Error code from the identity provider, present instead of `code` if the user denied consent.'),
  error_description: z
    .string()
    .optional()
    .describe('Human-readable error detail from the identity provider when `error` is set.'),
});

export const OAuthCallbackSuccessSchema = z.object({
  success: z.literal(true).describe('Present when the OAuth callback completed without a return_to.'),
});

export const GetMeSubjectSchema = z
  .object({
    id: z.string().describe('Stable subject identifier for the caller.'),
    type: z.string().describe('Subject kind as returned by the identity provider (stored as-is).'),
    display_name: z.string().describe('Human-readable name for the caller.'),
  })
  .openapi('GetMeSubject');

export const MeSessionTypeSchema = z
  .enum(['default', 'oidc-connected'])
  .describe(
    '`oidc-connected` when the process is running with browser OIDC login; `default` for standalone or TrueFoundry token auth.',
  )
  .openapi('MeSessionType');

export const MeSchema = z
  .object({
    type: MeSessionTypeSchema,
    tenant_id: z.string().describe('Tenant scope for the authenticated caller.'),
    subject: GetMeSubjectSchema,
    roles: z.array(z.string()).describe('Roles for the authenticated caller.'),
  })
  .openapi('Me');

export const GetMeResponseSchema = z.object({ data: MeSchema }).openapi('GetMeResponse');

export type GetMeSubject = z.infer<typeof GetMeSubjectSchema>;
export type MeSessionType = z.infer<typeof MeSessionTypeSchema>;
export type Me = z.infer<typeof MeSchema>;
export const AuthStatusSchema = z
  .object({
    authenticated: z.boolean().describe('Whether the current caller is authenticated.'),
    auth_enabled: z.boolean().describe('Whether browser OIDC login is enabled.'),
    public_origin: z.string().describe('Canonical public origin for the application.'),
    callback_path: z.string().describe('OAuth callback path.'),
    callback_url: z.string().describe('Full OAuth redirect URI.'),
  })
  .openapi('AuthStatus');

export const AuthStatusResponseSchema = z.object({ data: AuthStatusSchema }).openapi('AuthStatusResponse');

export type GetMeResponse = z.infer<typeof GetMeResponseSchema>;
export type AuthStatus = z.infer<typeof AuthStatusSchema>;
export type AuthStatusResponse = z.infer<typeof AuthStatusResponseSchema>;
