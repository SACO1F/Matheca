# Validation record

## Result

Independent finishing review: **ship**, with no material findings. Review covered the final source and four complete viewport captures; it did not independently repeat the browser interactions.

## Build and runtime

- `node --check main.js` passed.
- `npm run build` passed and checked all local HTML, stylesheet, image and font references.
- The production `dist/` website ran through the supplied Node preview server.
- Local fonts loaded successfully and the production page reported no console errors in the checked session.
- Both shipping raster plates passed provenance scanning: two images, zero missing embedded prompts.

## Browser behavior checked

- Keyboard addition of a question, filtering with selection preserved, reorder reflected in the exercise sheet.
- Removing every selected question produced the correct zero count, empty collection message and empty paper state.
- Changing the practice title updated the paper heading; the spacing checkbox changed question answer spacing.
- Metadata edits saved to the demonstration, the editor closed, and focus returned. Escape also closed the editor.
- Hiding and showing the reference answer worked.
- No horizontal document overflow at 390px, 735px or 306px viewports.
- Complete final captures were inspected at 1440px desktop, 390px phone, 735px user viewport and an additional 306px narrow viewport.

The single mechanical detector run identified low contrast and small text. A bounded correction batch darkened secondary text and editorial red, increased undersized paper metadata, and replaced the faint colored elevation with a neutral shadow. The final independent reviewer inspected those overrides. No broad accessibility certification is claimed.

## Approval and boundaries

The user approved the B concept, the source assets and the data-driven plot plan. After the automatic first-viewport capture tool rejected JavaScript/Canvas, the user explicitly approved the implemented screenshot as the visual baseline and instructed skipping that failed review. The historical automated phase record remains open; it was not relabelled as a successful gate.

The website has no application-data access, persistent storage, cloud account or real document-export endpoint. Demonstration values reset on refresh. Published download assets were verified on 2026-10-21 and are linked by exact version, not as a latest-release claim. Reduced-motion support is implemented and source-reviewed; changing the operating system motion preference was not automated.

No desktop application source was changed. Root PRODUCT.md and DESIGN.md were not read for this redesign.
