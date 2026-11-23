# Beam

Browser-based inbound returns inspection. Connect your own spreadsheet with a reusable column profile, find a return order, and compare a scan with expected quantities. No WMS integration, backend, analytics, or third-party runtime requests.

## Run locally

Requires Node.js 22 or later to build and serve, with no npm dependencies.

```sh
npm test
npm run serve
```

Open the local /beam/ URL printed by the server. In Settings → Help & examples, load fictional example data. For another spreadsheet use Settings → Reference data, choose an XLSX/XLSM file, and map its columns. Review Replace versus Append before submitting a new workbook. Location categories are opt-in and defined by the local profile.

## Deploy

For GitHub Pages, select **GitHub Actions** as the Pages source. The Pages workflow tests the exact static build and publishes only the allowlisted contents of `dist/` from the default branch. Asset URLs are relative to the project path. No company workbook, cloud URL, mapping profile, logos, or inspection export belongs in this repository.

## Code map

- `src/index.html`: semantic app shell and restrictive content security policy.
- `src/app.js`: application state, profile settings, rendering, and event wiring.
- `src/import/workbook.js`: bounded XLSX/XLSM import, sheet streaming and mapped value decoding. Domain conversions are injected by the app.
- `src/domain/`: directly tested tracking, name normalization, and Code 128 encoding.
- `src/styles/`: glass details and main workbench CSS. The release preserves cascade order.
- `src/vendor/` and `src/assets/`: bundled XML parser and font. Notices are retained with the distribution.

## Data boundary

The hosting service serves static application assets. XLSX files, searches, and scans are processed in the browser, not by the hosting service. Profiles and saved work may remain in the browser or in files an operator explicitly saves. A shared workstation or an exported file has its own access-control risks. Use synthetic data on public demos. The site is not a WMS and never writes to inventory.
