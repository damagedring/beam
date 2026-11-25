# Beam design ownership

`src/styles/tokens/status.css` owns the status palette and semantic ink and fill roles. Choose the role from the displayed fact. An accepted scan records the verdict at input time. Quantity progress compares current checked and expected units. Review and assignment states describe work that needs another decision. An accepted event can coexist with an excess quantity or an unresolved assignment.

The carton table and ledger keep the established neutral marks for matching or unexpected items. The recorded excess mark uses the existing warning ink through a local component alias. The quantity meter uses the shared excess ink. Update each treatment at its owner when making an intentional visual change.

`src/styles/tokens/typography.css` owns the UI, reading and terminal font stacks. `src/styles/tokens/controls.css` supplies the shared touch target size. Component geometry, density and animation sequences live with the corresponding view. `src/styles/receipt-paper.css` supplies the paper stock and perforation shared by Returns and Outbound. Each feature's receipt stylesheet controls its own spacing, reel, preview and touch treatment.

| Appearance | Owner |
| --- | --- |
| Product name and brand badge | `components/product-identity/view.css` |
| Product label preview and print stock | `components/product-labels/view.css` |
| Inspection and shipment print documents | `components/print/inspection-report.css` |
| Carton workspace and outbound receipts | `features/cartons/workspace.css` and `features/cartons/outbound-receipts.css` |
| Returns receipt variants and mobile quantity sheet | `features/returns/receipts.css` and `features/returns/quantities.css` |

`styles/workspace.css` still owns the existing Returns console, settings, navigation chrome and older search layout. Inspect the winning rule before moving any part of that cascade. `styles/glass.css` uses CSS layers whose precedence differs for important declarations. Keep focus and media-query behavior in scope when making a component change, and retain IDs used by labels or accessibility attributes.

Run `node tools/inspect-layout.mjs [source-directory]` for a source inventory. Counts are raw lines, comment-stripped `!important` and hex tokens, and distinct width values in media queries. The definition inventory is lexical. Verify computed values and states in the browser. The build checks custom property references in migrated owners, with an explicit exception for label geometry written by the print view. The reel and home layout also write geometry properties for their respective views.
