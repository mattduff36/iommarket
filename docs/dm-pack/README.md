# Private DM policy pack generation

The generator builds a dated private working pack from the canonical policy Markdown and moderation taxonomy. Generated files belong under `private/`, which is gitignored. They are working materials and must not be described as legally approved.

Run:

```bash
npm run dm-pack -- --date=2026-08-17
```

This always generates Markdown, JSON, a line redline, a change schedule, a moderation matrix, and the Vehicle Check source register under `private/dm-policy-pack-YYYY-MM-DD/`.

If Pandoc is installed, the same command also generates DOCX and attempts PDF generation. The equivalent deterministic conversion commands are:

```bash
pandoc "private/dm-policy-pack-2026-08-17/dm-policy-pack.md" --from=gfm --toc --standalone --output "private/dm-policy-pack-2026-08-17/dm-policy-pack-2026-08-17.docx"
pandoc "private/dm-policy-pack-2026-08-17/dm-policy-pack.md" --from=gfm --toc --standalone --pdf-engine=xelatex --output "private/dm-policy-pack-2026-08-17/dm-policy-pack-2026-08-17.pdf"
```

Use `--no-convert` to generate source artifacts without invoking Pandoc, or `--output=<path>` to choose another private output directory.
