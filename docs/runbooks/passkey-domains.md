# Passkey domain verification

Authority: Sherivs/sherivs issue #485 (MOB-00).
Creator: copilot-swe-agent[bot] (@copilot).
Created: 2026-11-24
Verification: focused unit tests cover redirect behavior; provider and device checks below are governed, not executed.

The application redirects apex marketing requests to `www`, except for
`/.well-known/*`, which must remain available on the WebAuthn RP host. The
apex-host redirect configured outside the application must be removed after
the code is deployed; do not make that provider setting change as part of this
change. Vercel also redirects `sherivs.ng` to `www.sherivs.ng`; removing that
redirect is optional and requires separate approval. Until then, do not expect
the `.ng` RP-host association endpoints to be reachable without a redirect.

After the required approval, remove the domain-level redirect for
`sherivs.com`, then verify the deployed behavior:

```sh
curl -sI https://sherivs.com/.well-known/assetlinks.json
curl -sI https://sherivs.com/.well-known/apple-app-site-association
curl -sI https://sherivs.com/.well-known/webauthn
curl -sI https://sherivs.com/
```

The well-known resources should return `200` with no `Location` header. The
apex homepage should return `308` with
`Location: https://www.sherivs.com/`. Verify Google Digital Asset Links sees
the configured Scholar package:

```sh
curl "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://sherivs.com&relation=delegate_permission/common.get_login_creds"
```

Finally, register and use a passkey on a non-production Scholar preview APK.
On the preview host, `curl -sI <preview>/.well-known/assetlinks.json` should
return `200`; Vercel preview hosts are not covered by the apex redirect.

`WEBAUTHN_ANDROID_SHA256_CERTS` accepts uppercase colon-separated SHA-256
fingerprints only. Lowercase or malformed entries are ignored consistently
for both `assetlinks.json` and native `android:apk-key-hash:` origin
validation. Add the Play App Signing certificate fingerprint to this variable
before releasing through Google Play.
