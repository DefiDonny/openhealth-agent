# Contributing

Thanks for considering a contribution.

- **Open an issue before large PRs** so we can agree on scope first.
- Keep changes focused — one topic per PR, clear commit messages.
- Run the build before pushing (`npm ci && npm run build`). CI additionally syntax-checks
  the sync service and runs a secrets/PII gate over the whole tree.
- **Never commit** real health data, credentials, personal names, domains or server paths.
  Use synthetic data (`demo/`).
- Sync-service changes: no credentials in code — configuration is environment-only, and a
  missing variable must fail loudly.
- Security issues: report privately rather than opening a public issue.

By contributing you agree your work is licensed under AGPL-3.0.
