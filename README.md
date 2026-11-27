# Beam

Beam is a browser-based workbench for warehouse operations. It helps operators find the right work, check physical items against the expected record, and leave a usable record when something differs. Those steps matter across receiving, shipping, inventory, and returns.

A returns check illustrates the workflow: connect a workbook once with a reusable column profile, find the order by store, customer or tracking number, scan the items, and review discrepancies before saving the result. Beam works alongside the warehouse system; it does not change inventory or require a WMS integration.

[Open Beam](https://damagedring.github.io/beam/)

## License

Beam-authored software and tests are available under the [PolyForm Noncommercial License 1.0.0](LICENSE). The packaged app and exporters include a copy as `LICENSE.txt`. The bundled fonts ([Pretendard](src/assets/OFL-Pretendard.txt), [Geist](src/assets/OFL-Geist.txt), and [Source Code Pro](src/assets/OFL-SourceCodePro.txt)) and [XML parser dependencies](src/vendor/xml-parser.js) retain their own terms and notices.

## Try it

In **Settings → Help & examples**, try the fictional Cry Later example or download its workbook and connection profile. To connect the downloads manually, import the profile JSON before the workbook in **Settings → Reference data**. Review whether you are replacing or appending orders when connecting your own data. Location categories are defined by the profile. Outbound shows eligible picking locations by default; Returns keeps its separate setting.

### Find the original outbound order

In Reference data, map the original outbound history sheet with its order ID and one or more lookup columns: outbound tracking number, delivery phone, or shipping address. Map customer name, telephone, and full shipping address on both sheets to enable automatic linking. Optionally map original tracking on the return sheet too. **Find original order** on a return receipt or inspection compares the available clues and ranks exact tracking matches first. If the original tracking number appears only on the physical return label, enter it in the lookup dialog. The return waybill is not treated as the original waybill. A single candidate whose customer name, phone, and full shipping address all match is linked automatically if the source data does not conflict. All other results require manual review. You can unlink or change an automatic match. Lookup values and links stay in the current browser session; they are not written back to the WMS or included in work files or PDFs.

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

`npm test` runs the unit, browser-flow and visual suites against one build. The visual suite uses Playwright's pinned Chromium at 1× scaling with separate baselines for macOS 26.4.1 arm64 and the Ubuntu 24.04 x64 GitHub Actions runner. CI checks every screenshot against the Linux baseline. Missing or different screenshots fail the suite. For an intentional change, run `npm run test:visual -- --update-snapshots=all` against a fresh build on the corresponding platform and review the resulting PNG changes. On other systems, run `npm run build && npm run test:unit && npm run test:flow`. The standalone `test:unit`, `test:flow`, `test:visual` and `test:perf` commands use the existing build.

GitHub Pages publishes only the allowlisted static assets from `dist/` after tests pass on the default branch. Do not commit company workbooks, mapping profiles, hosted internal endpoints, or inspection exports.

- [Architecture](docs/architecture.md) covers work ownership, browser adapters, import and the static build.
- [Design system](docs/design-system.md) covers status colors, paper and component styles.
- [Security and safe operation](docs/security.md) covers updates and data boundaries.

### Carton inspections and product labels

- **Outbound:** connect a picking-results sheet with the order ID, carton label, picked quantity, product name, and a barcode or SKU. Search by order, destination, or carton label. In the optional **DAS** mode, map the warehouse's assignment ID column to group orders; orders without an assignment stay in **Single order**. Open a carton directly from its receipt. Each carton keeps its own counts, progress, completion and inspection PDF. Reconnecting the exact reference restores saved completion marks and includes the other saved cartons in the order total. The separate **Shipment summary** is order-wide; select its print fields in the reference profile.
- **Inventory:** connect a Location sheet with an optional carton label column, or choose the delimiter between Location and carton in a combined column. Count the entire Location or each carton. Once scanning starts, the other method is view-only until those scans are undone. A saved completion keeps its counting method when the same reference reopens and across browser tabs.
- **Unscanned labels:** the selected return order or outbound carton prints one Code 128 product label per remaining unit. The active connection profile can hold several stock dimensions in mm. A4 remains available even when custom sizes are configured. Use actual-size printing and the matching stock in the printer driver. Sheet formats and barcode scanning should be verified on the target printer before use in production.
- Outbound and Inventory scans stay in the current tab while switching workflows. They are separate from Returns browser recovery and are not restored on reload.
