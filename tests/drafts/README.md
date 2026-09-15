# Draft tests

Generated draft specs from real usage logs land here via:

```
npm run test:gen:from-logs
```

Rules:

- Drafts are **never auto-run** in CI (Playwright `testMatch` only picks
  `tests/smoke/**` and `tests/regression/**`).
- Each draft carries a `HUMAN APPROVE REQUIRED` marker.
- To promote a draft: **review the business assertions**, move the file into
  `tests/regression/`, remove the marker, then commit.
- Draft output is gitignored (`tests/drafts/*`); approve the ones you want to
  keep by moving them out of this folder.

Source data: the `analytics_events` table in `db/confi.db` (real usage) or a
given DB via `--db <path>`.