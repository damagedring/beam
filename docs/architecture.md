# Beam architecture

`src/app.js` assembles the native modules and remains the owner of the active Returns work envelope and reference import lifecycle. `app/navigation.js` owns the active screen and applies the corresponding `hidden` and `inert` state. Search selection, dialogs and animation state live with their views. Navigation never creates or moves an inspection event.

| Change | Owner |
| --- | --- |
| Returns scan submission, undo or reset | `features/returns/scan-commands.js` owns event mutations and calls the workbench's routing and display callbacks. `domain/reconcile.js` classifies input and owns the incremental index. Initial assignment, automatic routing and manual reassignment retain separate verdict rules. |
| Outbound or Inventory scope, undo or completion | `features/cartons/model.js` owns work per workflow and order. It tallies counts by carton and maintains an order-wide projection. `domain/carton-verification.js` indexes immutable reference groups and preserves barcode precedence over SKU. The carton workspace owns the selected scope and renders the resulting rows. |
| Reference workbook or profile schema | `import/workbook.js` reads and validates local files. `import/mapping/profiles.js` validates columns, matches saved header names and preserves existing profile formats. The workbench coordinates asynchronous review, apply and profile persistence. |
| Browser scanner, audio, storage or print | `platform/inspection-input.js` binds the workflow's keyboard policy to the pure timing parser. `platform/scan-audio.js`, `platform/indexed-recovery.js`, `platform/reference-fingerprint.js` and `platform/print.js` contain the corresponding browser effects. |
| Returns recovery | `features/returns/recovery.js` coordinates exact reference and lookup fingerprints, checkpoint revision checks and restore confirmation. Outbound and Inventory retain independent in-tab work. |
| Product identity, report or label | `components/product-identity`, `components/print` and `components/product-labels` own markup and component styles. Code 128 encoding, label planning and brand normalization are in `domain/`. |

The Returns work envelope stores one copy of each scan. Views derive render data and can keep input drafts, focus targets and disposable timers. Returns reference change invalidates the domain index and related fingerprints. Carton reference replacement creates a new index and work map for that workflow. Undo updates the same carton ledger and preserves the ordering of surviving events.

The build in `tools/build.mjs` lists every shipped file and stylesheet in order. All literal relative JS imports and re-exports resolve within the allowlist and receive one shared revision. The build rejects domain imports outside the domain and private imports between features. Components and platform adapters communicate through explicit contracts assembled by the workbench.

The default artifact serves static files and processes workbooks and inspection records in the browser. Local fonts and license notices ship with it. Development tools, fixtures, tests and the optional exporters have independent paths. Exporter configuration uses deliberately supplied distinct HTTPS origins and retains the existing consent and one-use message boundaries. [Drive export](drive-export.md) and [OneDrive export](onedrive-export.md) describe the packaging inputs.
