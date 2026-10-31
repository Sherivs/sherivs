import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const query = String.raw`WITH matrix AS (
  SELECT r.code AS role_code, r.name AS role_name, '(role template)'::text AS responsibility,
         tp.kind AS responsibility_kind, p.code AS permission,
         CASE WHEN tp.kind = 'mandatory' THEN true ELSE coalesce(s.enabled, tp.default_on) END AS enabled,
         t.approval_limit_ngn AS approval_limit, t.guardrails
    FROM public.role_catalog r
    JOIN public.role_templates t ON t.code = r.template_code
    JOIN public.role_template_permissions tp ON tp.template_code = t.code
    JOIN public.permission_catalog p ON p.code = tp.permission_code
    LEFT JOIN public.org_role_permission_settings s
      ON s.org_id = :institution_id AND s.role_code = r.code AND s.permission_code = p.code
   WHERE r.org_id IS NULL OR r.org_id = :institution_id
  UNION ALL
  SELECT r.code, r.name, rc.code, rc.kind, p.code, true,
         t.approval_limit_ngn, t.guardrails
    FROM public.role_catalog r
    JOIN public.role_templates t ON t.code = r.template_code
    JOIN public.workspace_role_responsibilities rr
      ON rr.org_id = :institution_id AND rr.role_code = r.code
    JOIN public.workspace_responsibility_catalog rc
      ON rc.id = rr.responsibility_id
     AND (rc.org_id IS NULL OR rc.org_id = :institution_id)
    JOIN public.workspace_responsibility_permissions rp
      ON rp.responsibility_id = rc.id
    JOIN public.permission_catalog p ON p.code = rp.permission_code
   WHERE r.org_id IS NULL OR r.org_id = :institution_id
  UNION ALL
    SELECT r.code, r.name, rc.code, rc.kind, p.code, true,
           t.approval_limit_ngn, t.guardrails
      FROM public.role_assignment_responsibility_grants g
      JOIN public.user_role_assignments a ON a.id = g.assignment_id
      JOIN public.role_catalog r ON r.code = a.role_code
      JOIN public.role_templates t ON t.code = r.template_code
      JOIN public.workspace_responsibility_catalog rc ON rc.id = g.responsibility_id
      JOIN public.workspace_responsibility_permissions rp ON rp.responsibility_id = rc.id
      JOIN public.permission_catalog p ON p.code = rp.permission_code
     WHERE a.org_id = :institution_id AND a.status = 'active'
       AND a.started_at <= now() AND (a.valid_until IS NULL OR a.valid_until > now())
       AND g.revoked_at IS NULL AND g.valid_from <= now()
       AND (g.valid_until IS NULL OR g.valid_until > now())
    UNION ALL
  SELECT r.code, r.name, '(institution custom grant)', 'custom',
         coalesce(cg.permission_code, cg.custom_key), true,
         t.approval_limit_ngn, t.guardrails
    FROM public.role_catalog r
    JOIN public.role_templates t ON t.code = r.template_code
    JOIN public.org_role_custom_grants cg
      ON cg.org_id = :institution_id AND cg.role_code = r.code
   WHERE r.org_id IS NULL OR r.org_id = :institution_id
)
SELECT role_code, role_name, responsibility, responsibility_kind, permission,
       enabled, approval_limit, guardrails
  FROM matrix
 ORDER BY role_code, responsibility, permission;`;

export function renderPermissionMatrix() {
  return `# Role and responsibility permission matrix

The database catalog is the source of truth; do not maintain a second list of
roles or permissions in this document. The matrix is the union of:

- direct template permissions (\`role_template_permissions\`);
- responsibility permissions joined through the tenant's
  \`workspace_role_responsibilities\`;
- optional, time-bounded assignment responsibility grants;
- approval limits and guardrails on \`role_templates\`.

The query below produces the matrix for one institution without inventing role
or responsibility catalog rows. The new responsibility catalog is intentionally
unseeded in this engine task; catalog content is owned by a later mission.

\`\`\`sql
${query}
\`\`\`

For a person's **effective** matrix, use \`public.effective_permissions\` with the
authorized institution and user; it includes only assignments and delegations
that are active at query time and reports their effective scopes. Permission
checks remain server-side and in RLS. The mandatory separation-of-duties rules
are hard-coded in the database guard and cannot be disabled by an institution.
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync("docs/workspaces/permission-matrix.md", renderPermissionMatrix());
}
