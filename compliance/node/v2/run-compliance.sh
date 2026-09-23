#!/usr/bin/env bash
# One profile per private network; images must already be built/pulled.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
command_timeout=${SDK_COMPLIANCE_COMMAND_TIMEOUT_MS:-30000}
run_timeout=${SDK_COMPLIANCE_RUN_TIMEOUT_MS:-1200000}
startup_timeout=${SDK_COMPLIANCE_STARTUP_TIMEOUT_MS:-5000}
run_docker() { node "$script_dir/run-command.mjs" "$1" docker "${@:2}"; }
docker() { run_docker "$command_timeout" "$@"; }
adapter_image=${1:?adapter image required}
harness_image=${2:?harness image required}
mode=${3:?v0 or v1 required}
reports=${4:?new absolute report directory required}
case "$mode" in
    v0) profile=node-legacy ;;
    v1) profile=node-analytics-v1 ;;
    *) echo 'Unknown capture mode' >&2; exit 2 ;;
esac
[[ "$reports" = /* ]] || { echo 'Absolute report directory required' >&2; exit 2; }
mkdir "$reports"
network="node-v2-${mode}-$$"
adapter="${network}-adapter"
harness="${network}-harness"
check="${network}-check"
check_created=false
network_created=false
adapter_created=false
harness_created=false
cleanup() {
    status=$?
    trap - EXIT
    if "$adapter_created"; then
        docker logs "$adapter" > "$reports/adapter.log" 2>&1 || status=1
        docker rm -f "$adapter" > "$reports/adapter-cleanup.log" 2>&1 || status=1
    fi
    if "$harness_created"; then
        docker logs "$harness" > "$reports/harness.log" 2>&1 || status=1
        docker rm -f "$harness" > "$reports/harness-cleanup.log" 2>&1 || status=1
    fi
    if "$check_created"; then
        docker logs "$check" > "$reports/report-check.log" 2>&1 || status=1
        docker rm -f "$check" > "$reports/report-check-cleanup.log" 2>&1 || status=1
    fi
    if "$network_created"; then
        docker network rm "$network" > "$reports/network-cleanup.log" 2>&1 || status=1
    fi
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker network create --internal "$network" > "$reports/network.txt"
network_created=true
docker create --name "$adapter" --network "$network" --network-alias adapter \
    -e HOST=0.0.0.0 -e PORT=8080 -e "POSTHOG_CAPTURE_MODE=$mode" "$adapter_image" > "$reports/adapter.txt"
adapter_created=true
docker start "$adapter" > /dev/null
ready=false
for ((attempt = 0; attempt < 30; attempt++)); do
    if run_docker "$startup_timeout" exec "$adapter" node --input-type=module --eval '
        const response = await fetch("http://127.0.0.1:8080/v2/negotiate", {
            method: "POST", headers: {"content-type": "application/json"},
            body: JSON.stringify({protocol: "sdk-compliance-v2-draft2"}), signal: AbortSignal.timeout(1000)
        })
        if (!response.ok || (await response.json()).protocol !== "sdk-compliance-v2-draft2") process.exit(1)
    ' > "$reports/startup.log" 2>&1; then ready=true; break; fi
    sleep 1
done
"$ready" || { echo 'Adapter startup failed' >&2; exit 1; }
docker create --name "$harness" --network "$network" --network-alias harness \
    --mount "type=bind,src=$reports,dst=/reports" --entrypoint posthog-test-harness-v2 "$harness_image" \
    run --migration-suite --adapter-url http://adapter:8080 --allow-private-network \
    --mock-bind-host 0.0.0.0 --mock-advertised-host harness --profile "$profile" \
    --timeout-ms 60000 --report /reports/report.json > "$reports/harness.txt"
harness_created=true
set +e
run_docker "$run_timeout" start --attach "$harness" > "$reports/cli.log" 2>&1
result=$?
set -e
printf '%s\n' "$result" > "$reports/cli-exit.txt"
# Use the same generic validator as the runner, including matching diagnostics.
validation=0
if docker create --name "$check" --network none \
    --mount "type=bind,src=$reports,dst=/reports,readonly" --entrypoint posthog-test-harness-v2 "$harness_image" \
    check-report --report /reports/report.json --profile "$profile" > "$reports/report-check.txt"; then
    check_created=true
    docker start --attach "$check" > "$reports/report-check.log" 2>&1 || validation=$?
else
    validation=1
fi
printf '%s\n' "$validation" > "$reports/report-check-exit.txt"
if ((result != 0)); then exit "$result"; fi
exit "$validation"
