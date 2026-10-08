# Sherivs Brand Migration

Version target: **V1**.

## Rule

`classifyBrandReference` in `frontend/src/lib/brand/sherivs-brand.ts`.

| Surface | Class | Action taken |
| --- | --- | --- |
| UI copy, titles, descriptions | customer-facing | Say Sherivs |
| Metadata and canonical origin | customer-facing | `https://sherivs.com` |
| Comments | technical-identifier | Left as CoreGrid where they name the kernel |
| Type names, module paths | preserve | Not renamed |
| Migrations, tables, env keys | preserve | Not renamed |

`PLATFORM_NAME` is Sherivs. `PLATFORM_KERNEL_NAME` is CoreGrid. Chrome that already read `PLATFORM_NAME` follows the brand without a manual rewrite.

## Changed in this pass

- Platform identity module and the document title.
- Public homepage, which replaced the operator console.
- `/coregrid` marketing copy. The word "devices" was removed because device scope is V2 and frozen.
- Pricing highlights that claimed a Digital Twin product. The tier still exists; the claim does not.
- Account subtitle, so sign-in is not branded as the education runtime.
- Apple web app title.
- Operator console heading.
- Kernel page and generated platform-organization headings.
- Sitemap origin and `robots.txt`.
- A broken Open Graph image URL was removed. The file did not exist.

## Left in place on purpose

- Database identifiers, SQL migrations, and `CoreGrid` type names.
- File comments that document kernel phases.
- Authenticated page titles that still end in "CoreGrid" outside the files edited here. They are customer-facing and should move to `PLATFORM_NAME` in a follow-up that can review each title. A blind replace was not run.
- The legacy host `universalschoolos.com` may still appear in historical docs and in tenant JSON-LD that uses `window.location`. The canonical public origin for Sherivs pages is sherivs.com.

## Names

| Name | Meaning |
| --- | --- |
| Sherivs | Customer brand |
| Scholar | Education runtime. Installed. Not the platform |
| Jarvis | Executive intelligence. Same authority model as other workers |
| Sherivs AI Workforce | Governed workers |
| CoreGrid | Technical kernel |
