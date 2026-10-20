#!/usr/bin/env bash
# Zero-provider, zero-network regression tests for classify-ci-changes.sh.
set -euo pipefail

root="$(pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

git init -q -b main "$tmp/repository"
cd "$tmp/repository"
git config user.email "synthetic-ci@example.test"
git config user.name "Synthetic CI"
mkdir -p src docs
printf 'baseline\n' > README.md
printf 'baseline\n' > src/app.ts
printf 'baseline\n' > docs/start.md
git add README.md src/app.ts docs/start.md
git commit -qm "synthetic baseline"
git update-ref refs/remotes/origin/main HEAD

assert_scope() {
  local event="$1" base="$2" wanted="$3"
  : > "$tmp/output"
  GITHUB_EVENT_NAME="$event" GITHUB_BASE_REF="$base" \
    GITHUB_OUTPUT="$tmp/output" RUNNER_TEMP="$tmp" \
    bash "$root/.github/scripts/classify-ci-changes.sh" >/dev/null
  local actual
  actual="$(sed -n 's/^docs_only=//p' "$tmp/output" | tail -1)"
  if [[ "$actual" != "$wanted" ]]; then
    echo "Classifier mismatch for event=$event base=$base: $actual (expected $wanted)"
    exit 1
  fi
}

git switch -qc docs-only
mkdir -p docs/nested
printf 'new docs\n' > docs/nested/playbook.md
git add docs/nested/playbook.md
git commit -qm 'synthetic Markdown'
assert_scope pull_request main true
assert_scope push main false
assert_scope workflow_dispatch main false

git switch -qc code-change main
printf 'console.log("synthetic")\n' >> src/app.ts
git add src/app.ts
git commit -qm 'synthetic code'
assert_scope pull_request main false

git switch -qc mixed-change main
printf 'docs\n' >> docs/start.md
printf 'code\n' >> src/app.ts
git add docs/start.md src/app.ts
git commit -qm 'synthetic mixed'
assert_scope pull_request main false

git switch -qc code-deletion main
git rm -q src/app.ts
git commit -qm 'synthetic deletion'
assert_scope pull_request main false

git switch -qc workflow-change main
mkdir -p .github/workflows
printf 'name: test\n' > .github/workflows/test.yml
git add .github/workflows/test.yml
git commit -qm 'synthetic CI modification'
assert_scope pull_request main false

git switch -q main
assert_scope pull_request main false

git switch -q docs-only
if GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=missing-branch \
   GITHUB_OUTPUT="$tmp/output" RUNNER_TEMP="$tmp" \
   bash "$root/.github/scripts/classify-ci-changes.sh" >/dev/null 2>&1; then
  echo "Missing base branch incorrectly treated as successful"
  exit 1
fi
echo "CI change-scope classifier: 8 fail-closed fixture checks passed."
