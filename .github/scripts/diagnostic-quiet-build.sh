#!/bin/bash
set -euo pipefail

log_dir=".buildchain/diagnostics"
log_file="${log_dir}/quiet-build.log"
mkdir -p "${log_dir}"
: > "${log_file}"

echo "quiet build stdout/stderr: ${log_file}"
echo "quiet build started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

heartbeat() {
  while true; do
    sleep 60
    echo "quiet build heartbeat: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    if command -v ccache >/dev/null 2>&1; then
      ccache --show-stats 2>/dev/null | sed -n '1,5p' || true
    fi
  done
}

heartbeat &
heartbeat_pid="$!"
trap 'kill "${heartbeat_pid}" >/dev/null 2>&1 || true' EXIT

run_quiet() {
  name="$1"
  shift
  {
    echo
    echo "## ${name}"
    echo "start: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '$'
    printf ' %q' "$@"
    echo
  } >> "${log_file}"
  echo "quiet build step start: ${name}"
  "$@" >> "${log_file}" 2>&1
  {
    echo "end: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >> "${log_file}"
  echo "quiet build step end: ${name}"
}

run_quiet "make" corepack pnpm make
run_quiet "build" node .gyp/run-with-env.js KF_SKIP_MAKE_LIBNODE=true -- corepack pnpm build
run_quiet "package" corepack pnpm package

echo "quiet build finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
