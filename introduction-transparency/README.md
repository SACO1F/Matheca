# Matheca · 透片对位

Independent introduction website, built from the user's approved B direction and implemented first viewport. The complete page explains how collected mathematics problems become a personal exercise, with always-available Windows and Android downloads.

## Run

Requires Node.js 20 or later, with no packages to install.

- Double-click `START_PREVIEW.cmd`, then open the printed local URL.
- Or run `npm run preview` to serve `dist/` at http://127.0.0.1:5181/.
- To edit the source, run `npm run dev`; rebuild with `npm run build`.
- Deploy the complete `dist/` directory to any static HTTP host. Preserve its assets. Direct file:// opening is not the supported preview path.

The preview server binds only to 127.0.0.1 and does not read the Matheca application's data. Set the PORT environment variable if 5181 is occupied.

## What is interactive

The opening includes a data-driven quadratic plot, an answer visibility control and editable demonstration metadata. The collection area filters three sample problems, preserves selection across filters, adds/removes problems and changes their order. The final paper follows that order and updates its title and answer spacing.

These examples live in browser memory and reset on reload. PDF/DOCX generation happens in Matheca, not on this website. There is no analytics, account system, persistence, server database or API call in the demo.

## Resources and downloads

Chinese Noto Serif SC font subsets and KaTeX are served locally. Their licenses are in assets/fonts/OFL.txt and assets/katex/LICENSE.txt. The two photocopied source fragments are AI-generated demonstrations; exact prompts and provenance are retained with the source assets and embedded in their PNGs. They are not photographs of user questions.

Download links name specific published assets: Windows 0.1.0 and Android 0.22.0 Debug, checked against GitHub Releases on 2026-10-21. They are not a claim about the latest repository source or full feature parity of older binaries.

## Validation

Build checks resolve HTML and CSS resource references. Browser checks cover 1440px desktop, 390px phone, the 735px user viewport and an extra 306px narrow layout. Tests exercised keyboard addition, filter preservation, order-to-paper consistency, remove-all empty state, title/spacing changes and metadata editing. No horizontal document overflow was found at those narrow widths. Reduced-motion behavior is implemented in CSS and the motion observer; OS-level preference switching was not automated.

The user approved the implemented first viewport and explicitly waived the unsupported automatic first-viewport review. The engine's historical phase record remains open; no automated gate success or review receipt was fabricated. The final page is assessed against the user's implemented baseline and independent finishing review.
