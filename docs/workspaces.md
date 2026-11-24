# Internal Beam workspaces

An operator deployment represents one logistics operation. Its configured brands
are stable workspaces, independent of shift times. A responsible manager can
manage multiple assigned brands. Each brand has a separate invite, separate
participation, and separate approval. The feature does not grant access to
spreadsheets, scan records, exports, or Microsoft Teams.

## Local verification

Run `npm test`. To open it interactively, write an operator-owned JSON config
outside the checkout with one or more brands and workspace managers. Example
structure (replace the placeholder with an independently generated secret):

```json
{
  "organization": "Example operation",
  "brands": [{"id":"a","name":"Example A"},{"id":"b","name":"Example B"}],
  "hosts": [{"id":"manager-a","key":"REPLACE_WITH_AN_INDEPENDENT_RANDOM_KEY","brands":["a","b"]}]
}
```

Use one separate random key per manager (e.g. 32 random bytes encoded as base64url).
Store the configuration with restricted access and never commit or paste real
keys in Teams. Installations may share brand responsibility explicitly by
including the same brand in both managers' assigned brand lists.

Build Beam with `npm run build`. Run `npm run serve:workspaces` with
`BEAM_WORKSPACE_CONFIG` set to the absolute config-file path. The default URL
is `http://127.0.0.1:4173/beam/`. From there open the workspace control.
Open a second browser profile as the worker, use a generated link or short code,
and match the device number before approving. Approved status reappears in the
same browser profile on reload. Clearing its cookies requires approval again.
Guest participation and manager browser sessions last at most 12 hours;
an invite lasts 8 hours. Closing/rotating an invite does not revoke previously
approved devices. A manager can remove a device separately. Configured brands
persist; the service keeps invites and participation in memory only, so a
restart clears them. No roster, telemetry, chat, or job assignment is persisted.

## Internal deployment boundary

The ordinary static build never contains the workspace feature or exposes an API.
Use a dedicated, trusted private HTTPS origin with a company-approved
reverse proxy to the service's loopback port. Configure the canonical origin
via `BEAM_WORKSPACE_ORIGIN`. Preserve the matching Host header. Limit access
to authorized internal routes at that proxy/firewall. Use a single instance for
this pilot. Do not open inbound internet access, a public tunnel, or a public
reverse-proxy route. An address string, Wi-Fi name, Bluetooth proximity, invite
code, or private DNS by itself is not a network restriction. Verify the origin
fails from a non-approved connection and works from approved brand networks
before distributing invites; company-approved VPN access may still be permitted.
Do not log authorization headers, cookies, or request bodies.

Copy the invite into your existing Teams channel manually; Beam neither signs
in to Teams nor posts to it. Invite links keep the code in a fragment (the
front end removes it from the address bar). Requests require same-origin
navigation and approval is bound to the requesting browser's cookie and brand.
The invite does not open a workplace directory or grant access to other brands.
Approved access today opens the regular local Beam inspection app; the tool
does not sync scanner activity or bind the locally loaded workbook to a brand.
