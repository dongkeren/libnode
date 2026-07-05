#!/bin/bash
set -euo pipefail

log_dir=".buildchain/diagnostics"
log_file="${log_dir}/quiet-build.log"
process_context_file="${log_dir}/process-context.log"
mkdir -p "${log_dir}"
: > "${log_file}"
: > "${process_context_file}"

echo "quiet build stdout/stderr: ${log_file}"
echo "quiet process context: ${process_context_file}"
echo "quiet build started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

ps_one() {
  pid="$1"
  ps -o pid=,ppid=,pgid=,sess=,tty=,stat=,nice=,pri=,user=,command= -p "${pid}" 2>/dev/null \
    || ps -o pid=,ppid=,pgid=,tty=,stat=,nice=,user=,command= -p "${pid}" 2>/dev/null \
    || true
}

parent_pid() {
  pid="$1"
  ps -o ppid= -p "${pid}" 2>/dev/null | awk '{print $1}' || true
}

collect_process_context() {
  label="$1"
  {
    echo
    echo "## process context: ${label}"
    echo "timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "whoami: $(whoami 2>/dev/null || true)"
    echo "pwd: $(pwd)"
    echo "uname: $(uname -a 2>/dev/null || true)"
    echo "shell: ${SHELL:-}"
    echo "bash_pid: ${BASHPID:-}"
    echo "shell_pid: $$"
    echo "parent_pid: ${PPID:-}"
    echo "stdout_is_tty: $(test -t 1 && echo yes || echo no)"
    echo "stderr_is_tty: $(test -t 2 && echo yes || echo no)"
    echo "github_actions: ${GITHUB_ACTIONS:-}"
    echo "github_workflow: ${GITHUB_WORKFLOW:-}"
    echo "github_job: ${GITHUB_JOB:-}"
    echo "github_action: ${GITHUB_ACTION:-}"
    echo "github_ref: ${GITHUB_REF:-}"
    echo "github_sha: ${GITHUB_SHA:-}"
    echo "runner_name: ${RUNNER_NAME:-}"
    echo "runner_os: ${RUNNER_OS:-}"
    echo "runner_arch: ${RUNNER_ARCH:-}"
    echo "runner_temp: ${RUNNER_TEMP:-}"
    echo "runner_workspace: ${RUNNER_WORKSPACE:-}"
    echo
    echo "### stdio fds"
    ls -l /dev/fd/0 /dev/fd/1 /dev/fd/2 2>/dev/null || true
    if command -v lsof >/dev/null 2>&1; then
      lsof -a -p "$$" -d 0,1,2 2>/dev/null || true
    fi
    echo
    echo "### parent chain"
    current="$$"
    depth=0
    while [ -n "${current}" ] && [ "${current}" != "0" ] && [ "${depth}" -lt 16 ]; do
      ps_one "${current}"
      next="$(parent_pid "${current}")"
      [ "${next}" = "${current}" ] && break
      current="${next}"
      depth=$((depth + 1))
    done
    echo
    echo "### relevant process snapshot"
    ps -axo pid=,ppid=,pgid=,sess=,tty=,stat=,nice=,pri=,user=,pcpu=,etime=,command= 2>/dev/null \
      | grep -E 'Runner\\.|actions-runner|diagnostic-quiet-build|buildchain\\.mjs|node-make|make -j|make -C out|corepack pnpm|ccache|clang' \
      | grep -v 'grep -E' \
      || true
  } >> "${process_context_file}" 2>&1
}

heartbeat() {
  while true; do
    sleep 60
    echo "quiet build heartbeat: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    collect_process_context "heartbeat"
    if command -v ccache >/dev/null 2>&1; then
      ccache --show-stats 2>/dev/null | sed -n '1,5p' || true
    fi
  done
}

collect_process_context "script-start"

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
  collect_process_context "before-${name}"
  "$@" >> "${log_file}" 2>&1
  collect_process_context "after-${name}"
  {
    echo "end: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >> "${log_file}"
  echo "quiet build step end: ${name}"
}

run_quiet "make" corepack pnpm make
run_quiet "build" node .gyp/run-with-env.js KF_SKIP_MAKE_LIBNODE=true -- corepack pnpm build
run_quiet "package" corepack pnpm package

echo "quiet build finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
