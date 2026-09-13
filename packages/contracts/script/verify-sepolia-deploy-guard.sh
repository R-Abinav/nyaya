#!/usr/bin/env bash
# Verifies, by actually running it, that DeploySepolia.s.sol's dry-run guard
# (`vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)`) genuinely distinguishes a dry run from a real
# broadcast — flagged as untested since step 1, no longer assumed.
#
# Runs the real deploy script twice against a local anvil fork of live Sepolia (so every ENSv2 protocol
# call it makes hits real, currently-deployed contract code, not empty addresses on a bare chain, but costs
# nothing and sends nothing to the real network):
#   1. without --broadcast (dry run)   -> asserts deployments/sepolia.json is byte-for-byte unchanged
#   2. with --broadcast                -> asserts the file changed and contains freshly deployed addresses
#
# The real deployments/sepolia.json is backed up first and restored afterward unconditionally: step 2
# legitimately overwrites it with fork-only addresses that must never be mistaken for a real deployment.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${OPERATOR_PRIVATE_KEY:?OPERATOR_PRIVATE_KEY is not set. Run: set -a; source ../../.env; set +a}"
: "${SEPOLIA_RPC_URL:?SEPOLIA_RPC_URL is not set.}"
export OPERATOR_PRIVATE_KEY="0x${OPERATOR_PRIVATE_KEY#0x}"

PATH="$PATH:$HOME/.foundry/bin"
export PATH

DEPLOYMENTS_FILE="deployments/sepolia.json"
BACKUP_FILE="$(mktemp)"
ANVIL_LOG="$(mktemp)"
ANVIL_PID=""

cleanup() {
  if [ -n "$ANVIL_PID" ]; then
    kill "$ANVIL_PID" 2>/dev/null || true
    wait "$ANVIL_PID" 2>/dev/null || true
  fi
  cp "$BACKUP_FILE" "$DEPLOYMENTS_FILE"
  rm -f "$BACKUP_FILE" "$ANVIL_LOG"
}
trap cleanup EXIT

cp "$DEPLOYMENTS_FILE" "$BACKUP_FILE"
BEFORE_HASH=$(shasum -a 256 "$DEPLOYMENTS_FILE" | awk '{print $1}')

echo "== Starting a local anvil fork of live Sepolia =="
anvil --fork-url "$SEPOLIA_RPC_URL" --port 8555 --silent > "$ANVIL_LOG" 2>&1 &
ANVIL_PID=$!
for _ in $(seq 1 30); do
  if cast chain-id --rpc-url http://127.0.0.1:8555 > /dev/null 2>&1; then break; fi
  sleep 0.5
done
if ! cast chain-id --rpc-url http://127.0.0.1:8555 > /dev/null 2>&1; then
  echo "ABORTING: anvil never came up. Log:" >&2
  cat "$ANVIL_LOG" >&2
  exit 1
fi
echo "  anvil is up on http://127.0.0.1:8555"

echo ""
echo "== Part 1: dry run (no --broadcast) =="
forge script script/DeploySepolia.s.sol --rpc-url http://127.0.0.1:8555 2>&1 | tail -20
AFTER_DRY_RUN_HASH=$(shasum -a 256 "$DEPLOYMENTS_FILE" | awk '{print $1}')
if [ "$BEFORE_HASH" != "$AFTER_DRY_RUN_HASH" ]; then
  echo "FAIL: $DEPLOYMENTS_FILE changed during a dry run. The isContext guard is not working." >&2
  exit 1
fi
echo "PASS: $DEPLOYMENTS_FILE is byte-for-byte unchanged after the dry run."

echo ""
echo "== Part 2: real broadcast (--broadcast), against the anvil fork only =="
forge script script/DeploySepolia.s.sol --rpc-url http://127.0.0.1:8555 --broadcast --slow 2>&1 | tail -30
AFTER_BROADCAST_HASH=$(shasum -a 256 "$DEPLOYMENTS_FILE" | awk '{print $1}')
if [ "$BEFORE_HASH" == "$AFTER_BROADCAST_HASH" ]; then
  echo "FAIL: $DEPLOYMENTS_FILE did not change after a real broadcast." >&2
  exit 1
fi
echo "PASS: $DEPLOYMENTS_FILE changed after the broadcast."

echo ""
echo "== Sanity-checking the written file's shape and content =="
python3 - "$DEPLOYMENTS_FILE" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
assert d["network"] == "sepolia", "network field wrong or missing"
for key in ("NyayaAnchor", "UserRegistry", "PermissionedResolver"):
    addr = d["contracts"][key]
    assert addr.startswith("0x") and len(addr) == 42, f"{key} is not a well-formed address: {addr}"
assert int(d["nyayaTokenId"]) > 0, "nyayaTokenId missing or zero"
assert int(d["nyayaExpiry"]) > 0, "nyayaExpiry missing or zero"
for key in ("jurorA", "jurorB", "jurorC"):
    addr = d[key]
    assert addr.startswith("0x") and len(addr) == 42, f"{key} is not a well-formed address: {addr}"
print("PASS: written JSON has the expected nested shape and every address is well-formed.")
print(json.dumps(d, indent=2))
PYEOF

echo ""
echo "ALL CHECKS PASSED. Restoring the real deployments/sepolia.json (trap on exit)."
