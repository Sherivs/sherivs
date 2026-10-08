# Sherivs Brand Migration

## Classification

| Class | Action |
|---|---|
| Customer-facing UI copy, titles, PWA name, mobile display name, public site | **Sherivs** |
| Runtime product | **Scholar** / Sherivs Scholar |
| Executive intelligence | **Jarvis** |
| Kernel, packages, migrations, DB, file headers, capability keys (`coregrid_intelligence`) | **Preserve CoreGrid** |
| Bundle id `com.coregrid.app`, Expo slug, URL scheme | **Preserve** (install identity) |
| Legacy hosts `universalschoolos.com` | **Keep in PLATFORM_HOSTS** so tenants still resolve |
| Canonical public origin | `https://sherivs.com` |
| Cache | `sherivs-app-shell-v1` (old cache name retired) |

## Wave 1 completed in code

- `PLATFORM_NAME`  
- Public homepage and catalog  
- Public/PWA/mobile display strings listed above  
- Super-admin document titles  
- Command Centre chrome  
- Auth copy no longer defaults to “Scholar runtime” on the platform host  

## Explicitly not done (non-destructive)

- Renaming `package.json` `coregrid-scholar`  
- Rewriting 1,700+ technical CoreGrid references  
- Changing iOS/Android bundle identifiers  
- Deleting `/coregrid` (compatibility retained)
