# Optional Microsoft OneDrive work export (adapter candidate, not enabled)

This change is an unbundled adapter, not an active integration. The normal Beam
app and Pages build remain unchanged, do not load MSAL, and have no network
permission. Never integrate this module into the normal/offline app bundle.

## Destination and authority

- **Personal OneDrive:** Microsoft consumer authority, delegated
  `Files.ReadWrite.AppFolder` only. Resolve the signed-in account's approot and
  display the actual account and app folder. No picker or general Drive access.
- **Work/school OneDrive, Teams, SharePoint:** set exact tenant/client/drive/
  folder IDs and a recognizable administrator-supplied destination label.
  The admin must separately consent to delegated
  `Files.SelectedOperations.Selected` and pre-grant this app write access to
  that exact folder; intersect with the signed-in user's own permissions.
  This adapter cannot grant, infer, broaden, or change permissions or share
  links. It does not enumerate tenant sites or folders.
- No broader Files/Sites scopes are substitutes. A failed narrow request is
  blocked, not retried with broader scope.

## Future integration prerequisites

Provision a dedicated HTTPS exporter origin separately from Beam. Install and
pin a reviewed Microsoft MSAL Browser version there, use the applicable popup
redirect guidance for that version, register its exact SPA redirect URI, and
validate its browser and CSP behavior on the two actual origins. No client
secret. MSAL Browser uses authorization code with PKCE for SPA authentication.
This candidate constructs an injected PublicClientApplication with in-memory
cache settings. Do not use redirect navigation, silent flows, persistent token
storage or a backend proxy to make this feature work. The helper must live only
for one explicit flow and the exporter window must close or drop its state on
completion/cancel, including SDK-owned in-memory cache. The adapter's
`cancel()` drops its own one-shot authorization, but does not sign the user out
or clear Microsoft-hosted sessions.

Initialize the adapter before requiring a click; invoke
`chooseDestination()` inside the explicit account-chooser gesture (opens a
popup). It requests only the selected resource permission; the SDK can add
standard login scopes. Display the returned account, actual folder name and
destination label before enabling an explicit **Save new work file** action.
The action passes back the exact frozen destination object obtained in that
flow. Do not start it on popup completion, keyboard navigation, dialog open,
or a timeout. On close, denial or unconfirmed result, call `cancel()`, clear
draft data and drop the exporter instance. Never retry after bytes might have
been sent: tell the user to check the destination first.

Use Beam's `WorkDelta.prepareSave({compact:true})` and `assertCurrent()` only
after the user authorizes this exact named destination, then transfer only
`prepared.text` over a one-use exact-origin channel tied to the correct window
identity and a fresh nonce. Implement and independently review the isolated
handoff before enabling the adapter. Do not use this JSON shape guard as a
general sanitizer; the caller must use the real work-only serializer, not a
workbook, profile or arbitrary JSON input. Work records can themselves contain
order/store/scanning information; show the destination before transmission.
No file is downloaded, no link is shared, and no automatic synchronization
turns on.

The adapter generates a random new work filename, requests `conflictBehavior=fail`
(default PUT behavior is replace, so do not omit this parameter), refuses
redirects, and reports verified creation only for HTTP 201 plus exact returned
file name, size, parent IDs and a valid file item ID. A response missing these
fields is unconfirmed. It never accepts a server-supplied host or URL.

## Live verification gates

Microsoft's app-folder guide describes delegated approot, and its permissions
reference lists personal-account delegated consent for this preview scope.
However, the generic small-file upload endpoint lists broader permissions; do
not claim the exact narrow scope works for this path until synthetic staging
confirms it. The Selected permissions guide supports delegated permissions and
folder resource-specific consent; the same gating applies to the exact
pre-granted folder with an ordinary tenant account. If a tenant requires broad
access, leave the feature off.

Before enabling:
- Verify the actual SDK version's popup/redirect behavior and memory-only
  cache, exact scopes, expected tenant, personal account versus work account,
  and no transfer before the explicit named destination approval.
- Verify the authenticated Graph GET and exact documented conflict behavior
  on both types of folder with both a new file and a deliberate collision in
  an isolated synthetic test; an existing synthetic file must remain unchanged.
- Verify 201 payload fields and successful work-only restore. Verify CORS,
  error/cancel with no retries, lost-response behavior, closed exporter
  lifecycle, and that the standard Beam site still cannot send network data.
- Run local mock checks: `node --test tests/onedrive-export.test.mjs`.

Official references: [App folders](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder),
[Graph scopes](https://learn.microsoft.com/en-us/graph/permissions-reference#filesreadwriteappfolder),
[Selected permissions](https://learn.microsoft.com/en-us/graph/permissions-selected-overview),
[small-file PUT](https://learn.microsoft.com/en-us/graph/api/driveitem-put-content),
[driveItem conflict behavior](https://learn.microsoft.com/en-us/graph/api/resources/driveitem),
[MSAL configuration](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/configuration).

## Configuration-gated candidate build

A separate launcher and exporter handshake are implemented; no settings are
enabled in the default Pages build. For a future synthetic test deployment set
both `BEAM_APP_ORIGIN` and `BEAM_ONEDRIVE_EXPORTER_ORIGIN` to their distinct HTTPS
origins. If Drive is used, its exporter origin must also differ. Supply the
public Entra client ID in `BEAM_ONEDRIVE_CLIENT_ID` and either `personal` or
`work` via `BEAM_ONEDRIVE_KIND`. Only in work mode, set the exact pre-granted
`BEAM_ONEDRIVE_TENANT_ID`, `BEAM_ONEDRIVE_DRIVE_ID`, `BEAM_ONEDRIVE_FOLDER_ID`
and a public `BEAM_ONEDRIVE_FOLDER_LABEL`. These are public deployment config,
not secrets; use a private staging exporter if the folder identity must remain
private. Do not add any of these variables to the public Pages workflow.

Supply two separately reviewed self-contained ESM bundles:
`BEAM_MSAL_ESM_FILE` and `BEAM_MSAL_ESM_SHA256` for the MSAL Browser v5
PublicClientApplication export, and `BEAM_MSAL_BRIDGE_FILE` and
`BEAM_MSAL_BRIDGE_SHA256` for a bundle that imports
`broadcastResponseToMainFrame` from `@azure/msal-browser/redirect-bridge` and
calls it as Microsoft documents. Include SDK source notices and audit the exact
inputs before setting the hashes; hashes identify reviewed bytes, not vendor
provenance. This build never fetches a dependency or supplies a default SDK.

Run `npm run build` and `node tools/build-onedrive-exporter.mjs` with those
variables in the same environment. Publish only `dist/` to the Beam origin,
and separately only `dist-onedrive-export/` at the root of the configured
Microsoft exporter origin. Register the exact `/redirect.html` HTTPS URI as an
SPA redirect. Validate the real deployment headers: prohibit framing with
`frame-ancestors 'none'` and serve the bridge without COOP as Microsoft requires.
Verify that top-level popup/opener isolation is compatible with the two
one-shot handoffs and auth bridge before handing it to a user. The module
never imports the SDK from a CDN.

When testing, account selection and the initial exact-origin MessagePort
handoff must send no inspection records. Only the confirmed destination
button sends the one-use request that makes Beam serialize and send work
records. On cancellation or disconnect no retry occurs. For the SDK itself,
check the exact release and its memory-caching behavior, not just the adapter
configuration. See [Microsoft’s redirect bridge instructions](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/redirect-bridge).
