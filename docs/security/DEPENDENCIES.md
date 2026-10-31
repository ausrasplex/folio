# Dependency Audit Notes

`npm run audit` (`npm audit --omit=dev`) lists known problems in the packages Folio runs on. The pre-exposure checklist in [REMOTE-ACCESS.md](REMOTE-ACCESS.md#before-you-expose-folio) asks for it to be clean, or for each finding to be noted here with why it doesn't affect Folio. Look again whenever the audit changes.

## Findings Noted on 31 October 2026

`npm run audit` reported 5 (1 moderate, 4 high), in two groups. Neither can be reached through Folio, and the only fixes are major upgrades.

### PostCSS, through Next.js 15.5.28

- Advisories: [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) (unescaped `</style>` in output), [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) and [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) (source map files read through `sourceMappingURL`).
- Why it doesn't affect Folio: PostCSS only processes Folio's own stylesheets, when the app is built. Folio never takes CSS from the people using it, so an attacker has no way to get CSS, or a source map comment, in front of PostCSS.
- Fix: Next.js 16, a major version with breaking changes.

### deepmerge-ts, through Prisma 6.19.3 (`@prisma/config`)

- Advisory: [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) (stack exhaustion when merging an object that refers to itself).
- Why it doesn't affect Folio: it is used by Prisma's configuration loader, on Prisma's own configuration, when the `prisma` command runs (migrations, generating the client). Nothing from the people using Folio is merged by it.
- Fix: Prisma 7, a major version with breaking changes.

## Planned

Upgrading to Next.js 16 and Prisma 7 clears both, and should be its own piece of work: each changes how the app is configured and built, so it needs the full test run, the end-to-end checks and a look at every screen afterwards.
