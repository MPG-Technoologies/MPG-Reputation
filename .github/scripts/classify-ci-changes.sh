#!/usr/bin/env bash
# Conservative docs-only fast-path classifier shared by MPG Reputation CI.
# A failed diff, missing base, empty diff, workflow/script/config/migration
# change, or non-PR event must never be treated as documentation-only.
set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
docs_only=false

if [[ "${GITHUB_EVENT_NAME:-}" == "pull_request" ]]; then
  : "${GITHUB_BASE_REF:?A pull request requires a base ref}"
  : "${RUNNER_TEMP:?RUNNER_TEMP is required}"

  git check-ref-format --branch "$GITHUB_BASE_REF" > /dev/null
  git rev-parse --verify "refs/remotes/origin/${GITHUB_BASE_REF}^{commit}" > /dev/null

  # NUL-delimited paths avoid treating filenames containing newlines as
  # multiple independently allowlisted changes. Include deletions too.
  changed="$RUNNER_TEMP/mpg-ci-changed-paths"
  git diff --name-only -z "origin/${GITHUB_BASE_REF}...HEAD" > "$changed"

  if [[ -s "$changed" ]]; then
    docs_only=true
    while IFS= read -r -d '' path; do
      case "$path" in
        README.md|docs/*.md) ;;
        *) docs_only=false ;;
      esac
    done < "$changed"
  fi
fi

printf 'docs_only=%s\n' "$docs_only" >> "$GITHUB_OUTPUT"
if [[ "$docs_only" == "true" ]]; then
  echo "Documentation-only pull request: keep the existing CI job/check, skip heavyweight app and disposable database steps."
else
  echo "Executable/config/security/migration/unknown change or non-PR event: run the complete verification path."
fi
