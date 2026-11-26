# Optional Google Drive export

Beam's normal GitHub Pages build is local-only and never loads Google libraries or calls Google API endpoints. This optional workflow creates **one new work-only JSON file per explicit user request** in the selected Google account's My Drive root by default, or in one explicitly selected folder when Picker is configured. It doesn't replace a file, request broad Drive/list access, or make a browser download. It's a work snapshot, not a synchronization service. Employer or workspace policy still applies.

## Deployment prerequisites

1. Choose **two distinct HTTPS origins you control**, e.g. `https://beam.example.com` and `https://export.example.com`. Set origins exactly, without a trailing slash or path. Never host the exporter under a path on the Beam app origin. Do not share cookies, frames, sign-in state, or other applications on the exporter origin. Use a dedicated origin without analytics, a service worker, untrusted scripts, or user content.
2. In a Google Cloud project enable Google Drive API. Configure the OAuth consent screen/audience (with the required published app, policy, or test-user setup for the intended users). Create an **OAuth 2.0 Web application client**. Its Authorized JavaScript origins must include the exact **exporter origin**. No OAuth client secret, API key, refresh token, redirect endpoint, or server is used by this token integration. The Web client ID is public configuration. Grant only the `https://www.googleapis.com/auth/drive.file` scope. Organization policy may still block the client.
3. A configured Beam app must be allowed to open the cross-origin exporter, and the exporter must be allowed to open the Google authorization popup. Serve **neither** origin with `Cross-Origin-Opener-Policy: same-origin` / `Cross-Origin-Embedder-Policy: require-corp` for this path. A compatible deployment must preserve the cross-origin opener only until the exact-origin handshake. Use the popup-compatible COOP guidance from Google for the exporter; validate the final response headers and opener behavior on target browsers before release. Set `Content-Security-Policy: frame-ancestors 'none'` as a response header on the exporter if supported (meta cannot enforce it) in addition to its built-in CSP, not instead of it. Set `X-Content-Type-Options: nosniff`, and serve `.mjs` as JavaScript.

## Build and verify, without changing the standard workflow

```sh
# Normally off. Existing release workflow doesn't set these values.
npm run build

# Optional configured pair. Example values are placeholders.
export BEAM_APP_ORIGIN=https://beam.example.com
export BEAM_DRIVE_EXPORTER_ORIGIN=https://export.example.com
export BEAM_DRIVE_OAUTH_CLIENT_ID=123456789012-example.apps.googleusercontent.com
npm run build
node tools/build-drive-exporter.mjs
```

Deploy `dist/` only to the Beam app. Deploy `dist-drive-export/` separately at the **root of the exporter origin**. Never copy exporter files into `dist/`. If not configured, Google Drive settings explain why connection and manual save are unavailable. A standalone visit to the exporter is inert. Publish both outputs using the same configured pair.

Before enabling for actual work, verify with synthetic RAW and a test Google account in the real staging browser:
- The **main app** still has `connect-src 'none'`; it never loads GIS or speaks to Google APIs. Existing manual work downloads and local browser recovery remain available.
- After explicit approval, a one-time random handshake checks both exact origins, both window identities, nonce, and one message port. The isolated window releases its opener after handoff. Closing or timing out does not retry. Verify browser popup behavior and Google token popups on Chrome and Edge; check Safari if supported.
- The user selects a Google account and consents. The client requests only `drive.file`. It doesn't save OAuth tokens, access unrelated Drive files, or upload reference RAW, customer-lookup lists, or source file labels. Inspect the resulting JSON and restore it against the matching reference files using the existing record-only restore flow.
- Confirm actual My Drive file creation and the final file link for a small file (multipart) and for a test work snapshot over 5 MB (resumable initiation + one PUT, 50 MB existing work ceiling). For resumable uploads, the browser must be able to read the Drive `Location` response header via CORS. A resumable response that is inaccessible or on an unexpected endpoint is rejected, not broadened or proxied.
- A network failure after transferring bytes can be ambiguous. The page reports that it cannot confirm the result and instructs the user to check Drive before retrying. It does not claim success without receiving a well-formed file ID. The exporter doesn't clear dirty status or turn on synchronization.

## Google primary references

- [GIS web OAuth token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [GIS JavaScript OAuth API](https://developers.google.com/identity/oauth2/web/reference/js-reference)
- [Web client ID, CSP and COOP setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)
- [Drive API scopes and authorization](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Drive upload types and resumable upload contract](https://developers.google.com/workspace/drive/api/guides/manage-uploads)

## Optional worker-selected folders

Picker can be configured in the isolated exporter so each worker can choose a folder their own Google account is invited to, or a folder in a Shared drive they can use. An invitation alone does **not** authorize creating files; view-only access, expired authorization, Google org policy or lack of Picker per-file grant can block the operation. The exporter confirms `capabilities.canAddChildren === true` for the selected non-trashed folder using the same access token before enabling the final save button. Drive still checks permissions at creation time.

Enable Google Picker API in the **same Google Cloud project** as the OAuth client. Create a restricted **browser API key**, allow only Google Picker API use, and configure allowed HTTP referrers for the dedicated exporter and the Google Picker iframe per Google's setup guide (including `https://docs.google.com/*` if required). Supply the public browser key and numeric project **number**:

```sh
export BEAM_DRIVE_PICKER_API_KEY=PUBLIC_BROWSER_RESTRICTED_KEY
export BEAM_DRIVE_PICKER_PROJECT_NUMBER=123456789012
node tools/build-drive-exporter.mjs
```

With neither value configured, the exporter keeps its root-only workflow. With both set, choose either My Drive root or the folder workflow. The folder workflow asks Google Picker for exactly one folder, checks permission with `supportsAllDrives=true`, and shows the folder's Drive-returned name plus a sharing notice before explicit creation. Creation sets exactly that folder as parent and supports Shared drives. It never changes folder or file sharing, stores a favorite folder, requests wider OAuth scope, or falls back to a personal folder after an error. Child rules of the chosen folder may apply to the created file by default. A resource key, if supplied by Picker, stays in the export window and is used only in Drive request headers.

Validate actual Google Picker CSP requirements and workflow before production. Test a writable shared-to-me invite, a viewer-only invite (must not create), and a writable Shared drive folder with the corresponding accounts. Mock tests do not establish end-to-end Google account access, organization consent, or folder visibility.

- [Picker web deployment and API key restrictions](https://developers.google.com/workspace/drive/picker/guides/web-picker)
- [Shared drive support and request parameters](https://developers.google.com/workspace/drive/api/guides/enable-shareddrives)
- [Drive file capabilities and parent fields](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
- [Drive link-sharing resource keys](https://developers.google.com/workspace/drive/api/guides/resource-keys)


## Settings and sync

The Settings entry can open a connection check separately from manual save. The check requests the same limited Drive permission in the isolated window, sends no inspection payload, writes no file and discards the token when finished. It is not a persistent sign-in. Automatic synchronization stays off and unavailable in this build. Before enabling it, add an explicitly approved destination, authorized save scope and a tested way to stop queued writes; do not relax the main application's offline policy.
