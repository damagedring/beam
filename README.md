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

Use Node.js 24 LTS. npm installs development tools for building and testing. The static browser runtime has no npm dependencies.

```sh
npm ci
npx playwright install chromium
npm test
npm run serve
```

`npm test` runs the unit, browser-flow and visual suites against one build. The reference screenshots use Playwright's pinned Chromium on macOS 26.4.1 arm64 with 1× scaling. On other systems, run `npm run build && npm run test:unit && npm run test:flow`, as the Linux GitHub runner does. The standalone `test:unit`, `test:flow`, `test:visual` and `test:perf` commands use the existing build.

GitHub Pages publishes only the allowlisted static assets from `dist/` after tests pass on the default branch. Do not commit company workbooks, mapping profiles, hosted internal endpoints, or inspection exports.

- [Architecture](docs/architecture.md) covers work ownership, browser adapters, import and the static build.
- [Design system](docs/design-system.md) covers status colors, paper and component styles.
- [Security and safe operation](docs/security.md) covers updates and data boundaries.

### Carton inspections and product labels

- **Outbound:** connect a workbook sheet with order ID, carton label ID, product name, expected units, and product barcode and/or SKU. Search by order ID, carton label, or a mapped destination store. Choose the order, then the carton, and start scanning. Each carton keeps a separate count and can print its own comparison PDF. The separate order-level **Shipment summary** can include both order identifiers, the carton count and labels, destination store and country. Choose its print fields under the active reference profile; outbound column choices are saved by header name.
- **Inventory:** connect a Location sheet with an optional carton label column, or choose the delimiter between Location and carton in a combined column. Count the entire Location or each carton. Once scanning starts, the other method is view-only until those scans are undone, so the same stock cannot enter both counts.
- **Unscanned labels:** the selected return order or outbound carton prints one Code 128 product label per remaining unit. The active connection profile can hold several stock dimensions in mm. A4 remains available even when custom sizes are configured. Use actual-size printing and the matching stock in the printer driver. Sheet formats and barcode scanning should be verified on the target printer before use in production.
- Outbound and Inventory scans stay in the current tab while switching workflows. They are separate from Returns browser recovery and are not restored on reload.
