# Beam

Beam is a browser-based workbench for warehouse operations. It helps operators find the right work, check physical items against the expected record, and leave a usable record when something differs. Those steps matter across receiving, shipping, inventory, and returns.

A returns check illustrates the workflow: connect a workbook once with a reusable column profile, find the order by store, customer or tracking number, scan the items, and review discrepancies before saving the result. Beam works alongside the warehouse system; it does not change inventory or require a WMS integration.

[Open Beam](https://damagedring.github.io/beam/)

## Try it

In **Settings → Help & examples**, load the fictional example data. To connect your own data, use **Settings → Reference data** to open an XLSX/XLSM workbook or load a saved connection profile. Review whether you are replacing or appending orders. Location categories are opt-in and defined by the profile.

## Where data stays

The hosting service serves the app. Workbooks, searches, and scans are processed in the browser. The public build has no analytics, backend, or third-party runtime requests. Profiles and saved work can remain on the device; use fictional data when showing Beam publicly.

Beam keeps a local draft while you work. After a reload, connect the same reference data and select **Recover work**. A different reference or customer-lookup set cannot restore that draft. Browser storage is not a backup; save a separate work file if you need to keep the record. Drafts do not contain the reference workbook or lookup file.

## Develop and deploy

Use the current Node.js 24 LTS security patch. There are no npm dependencies.

```sh
npm test
npm run serve
```

GitHub Pages publishes only the allowlisted static assets from `dist/` after tests pass on the default branch. Do not commit company workbooks, mapping profiles, hosted internal endpoints, or inspection exports.

- `src/domain/`: reconciliation, scan ordering, recovery, Code 128, and report formatting.
- `src/import/`: workbook reading and mapped-cell decoding.
- `src/app.js` and `src/styles/`: workbench state, actions, and presentation.
- [Internal Beam workspaces](docs/workspaces.md): optional company-network setup with brand-scoped invitations.
- [Security and safe operation](docs/security.md): update guidance and data boundaries.
