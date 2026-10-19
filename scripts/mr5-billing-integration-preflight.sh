#!/usr/bin/env bash
# MR-5I0 information-only preview. No commits/push/deploy/production actions.
set -euo pipefail
source_branch='chatgpt/mr5c3c2a-recovery-operator-guard'
source_ref="refs/remotes/origin/$source_branch"
if [[ "$CI" != true || -z "$RUNNER_TEMP" || -z "$GITHUB_STEP_SUMMARY" ]]; then
  echo 'MR5_PREFLIGHT_CI_ONLY'; exit 2
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo 'MR5_PREFLIGHT_WORKTREE_NOT_CLEAN'; exit 2
fi
if [[ -n "$SUPABASE_SERVICE_ROLE_KEY" || -n "$STRIPE_SECRET_KEY" ]]; then
  echo 'MR5_PREFLIGHT_CREDENTIALS_FORBIDDEN'; exit 2
fi
git fetch --no-tags origin "+refs/heads/$source_branch:$source_ref"
source_sha="$(git rev-parse "$source_ref")"
target_sha="$(git rev-parse HEAD)"
base_sha="$(git merge-base "$source_sha" "$target_sha")"
source_only="$(git rev-list --count "$target_sha..$source_sha")"
target_only="$(git rev-list --count "$source_sha..$target_sha")"
scratch="$(mktemp -d "$RUNNER_TEMP/mr5-merge-preview.XXXXXX")"
rmdir "$scratch"
git worktree add --detach "$scratch" "$target_sha" >/dev/null
cleanup() {
  if [[ -f "$scratch/.git" ]]; then
    git -C "$scratch" merge --abort >/dev/null 2>&1 || true
    git worktree remove --force "$scratch" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
git -C "$scratch" config user.name 'MPG Read-Only CI'
git -C "$scratch" config user.email 'preview@invalid.test'
set +e
git -C "$scratch" merge --no-commit --no-ff "$source_sha" > "$RUNNER_TEMP/mr5-preview.log" 2>&1
merge_code=$?
set -e
conflicts="$(git -C "$scratch" diff --name-only --diff-filter=U)"
if [[ "$merge_code" -ne 0 && -z "$conflicts" ]]; then
  echo 'MR5_PREFLIGHT_UNEXPECTED_MERGE_ERROR'
  head -n 25 "$RUNNER_TEMP/mr5-preview.log"
  exit 1
fi
{
  echo '## MR-5I0: informational billing branch compatibility preview'
  echo
  echo 'Not a merged, deployed or tested billing system.'
  echo
  echo "Target SHA: $target_sha"
  echo "MR-5C SHA: $source_sha"
  echo "Merge base: $base_sha"
  echo "MR-5C-only commits: $source_only"
  echo "MR-5D/E-only commits: $target_only"
  echo
  if [[ "$merge_code" -eq 0 ]]; then
    echo 'Preview: no text-level conflicts. Behavioral/schema integration NOT verified.'
  else
    echo 'Preview: BLOCKED by file-level conflicts. No integration occurred.'
    echo 'Conflicting paths:'
    printf '%s\n' "$conflicts"
  fi
  echo
  echo 'All work was isolated in a temporary worktree and discarded.'
} | tee "$RUNNER_TEMP/mr5-merge-summary.md" >> "$GITHUB_STEP_SUMMARY"
echo "MR5_TARGET=$target_sha"
echo "MR5_SOURCE=$source_sha"
if [[ "$merge_code" -ne 0 ]]; then printf 'MR5_CONFLICTS:\n%s\n' "$conflicts"; fi
