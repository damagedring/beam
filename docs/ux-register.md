# Beam UX register

Use these stable IDs when reviewing changes to observable behavior. Check the affected workflow in the built app.

## Reference data, search and input

| ID | Observable behavior |
| --- | --- |
| UX-01 | The default build processes workbooks, searches and scans locally, and optional export starts with an explicit action. |
| UX-02 | A saved profile reconnects workbook columns by header name when the columns move. |
| UX-03 | A new workbook schema preserves earlier profiles, and a cancelled or superseded import leaves the current data and profile intact. |
| UX-04 | Replacing or appending reference data preserves existing inspection work, and reference verification preserves open dialogs, drafts and input focus. |
| UX-05 | B2B search uses store names, B2C uses customer names, and tracking lookup keeps leading zeros and leaves ambiguous matches available for selection. |
| UX-06 | Enter advances from search through selection to inspection one step at a time, with held keys and IME composition leaving that sequence intact. |
| UX-07 | Arrow keys, Tab and Escape follow the active view while editable controls and native scroll areas retain their usual behavior. |
| UX-08 | The active inspection accepts a scanner burst once even after focus moves, while ordinary typing and input in editors or dialogs stay with their controls. |

## Inspection records and recovery

| ID | Observable behavior |
| --- | --- |
| UX-09 | On a locked order with three expected units, a fourth scan records excess and the earlier three retain their accepted verdicts. |
| UX-10 | Unknown input has its own verdict and leaves expected-quantity coverage unchanged. |
| UX-11 | Progress reflects the active scope, and extra units of one SKU leave another SKU’s shortage unchanged. |
| UX-12 | Reassignment offers only eligible orders, and reassignment and undo update totals while preserving the identity and order of surviving entries. |
| UX-13 | Switching order tabs changes the selected view and preserves the scan records belonging to each order. |
| UX-14 | Accepted, excess and unknown scans have their respective sounds, and scans still record when audio is unavailable. |
| UX-15 | Returns offers recovery only for matching reference and customer lookup data, and a newer draft takes precedence over a stale tab’s write. |
| UX-16 | Returns restores valid drafts and compatible saved work and keeps the active session usable if browser storage fails. |
| UX-17 | Outbound and Inventory keep separate work when switching workflows within a tab, and a reload starts a fresh carton inspection session. |

## Workflow and presentation

| ID | Observable behavior |
| --- | --- |
| UX-18 | Outbound search keeps orders, cartons and mapped destinations distinct and leaves ambiguous carton matches for selection. |
| UX-19 | Each outbound carton retains its inspection count when the operator switches scope. |
| UX-20 | Inventory counts by Location or by carton, with the alternate scope view-only until scans in the current scope are undone. |
| UX-21 | Label previews group products with remaining units, and printing keeps the corresponding copy counts, batch boundaries and mapped barcodes. |
| UX-22 | Known brands appear in the badge, and the displayed name drops only a delimited leading prefix that matches the mapped brand. |
| UX-23 | Label previews page by keyboard or touch, return focus on close and block printing if the work scope has changed. |
| UX-24 | Returns and Outbound receipt gestures commit according to the active view, keep the previous selection on cancellation and allow native vertical scrolling. |
| UX-25 | Long store names and receipts remain readable, with scrolling and pagination inside the receipt where applicable. |
| UX-26 | On a phone, opening a workflow leaves the software keyboard closed until the user taps an editable field. |
| UX-27 | The mobile quantity sheet opens safely with or without data and returns focus on close, and the F2 preview closes on release, Escape or blur. |
| UX-28 | Switching between light and dark themes preserves inspection work, information hierarchy and visible status distinctions. |
| UX-29 | Keyboard focus stays identifiable and Korean and English text stays readable with forced colors and reduced motion or transparency. |
| UX-30 | Home opens the enabled workflows, and visiting Settings or Help leaves inspection work intact. |

## Print and performance

| ID | Observable behavior |
| --- | --- |
| UX-31 | Inspection printouts encode the supported internal order ID in Code 128 and show the external ID, work and quantities separately. |
| UX-32 | The outbound shipment summary prints the selected order-level fields and carton details separately from the carton comparison. |
| UX-33 | Label print layouts use millimetres, swap dimensions in landscape and keep A4 available. |
| UX-34 | A long scan session stays responsive and preserves input counts and order. |
