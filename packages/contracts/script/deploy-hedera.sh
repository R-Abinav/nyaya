#!/usr/bin/env bash
# Hedera deploy wrapper: forge create + cast send, never forge script. Hashio (Hedera's JSON-RPC relay)
# rejects the EIP-1898 block-hash parameters forge script's forking depends on — tested directly against
# Hashio with Foundry 1.8.1, not assumed; see .claude/rules/contracts.md's "Deploys: two mechanisms" section.
#
# Deploys JurorTreasury, NyayaResolver (with cancel and openCaseFromTreasury — this is the first deploy of
# either), and JurorShareMarket, wires treasury.setResolver, and unconditionally overwrites
# deployments/hedera.json with exactly this run's addresses.
#
# Genesis parameters (withdrawal cap, withdrawal window) match the values already live on the currently
# deployed JurorTreasury, read directly on-chain before writing this script, not guessed:
#   withdrawalCap()    = 1000000000 tinybars (10 HBAR)
#   withdrawalWindow() = 3600 seconds (1 hour)
set -euo pipefail

cd "$(dirname "$0")/.."

WITHDRAWAL_CAP=1000000000
WITHDRAWAL_WINDOW=3600

: "${OPERATOR_PRIVATE_KEY:?OPERATOR_PRIVATE_KEY is not set. Run: set -a; source ../../.env; set +a}"
: "${OPERATOR_PUBLIC_KEY:?OPERATOR_PUBLIC_KEY is not set.}"
: "${HEDERA_RPC_URL:?HEDERA_RPC_URL is not set.}"

# forge/cast require the 0x prefix; some .env values are stored bare.
PK="0x${OPERATOR_PRIVATE_KEY#0x}"

echo "== Preflight: operator balance on Hedera =="
# A weibar balance is an 18-decimal number and routinely exceeds bash's 64-bit signed `$(( ))` range (e.g.
# 55 HBAR is ~5.5e19 weibar, well past 9.2e18) — that overflow silently wraps to a small, wrong number and
# was caught here reporting "0.12 HBAR" for an account that actually held 55. Do the division in python,
# which has no such limit, never in bash arithmetic, for any weibar-scale value.
BALANCE_WEIBAR=$(cast balance "$OPERATOR_PUBLIC_KEY" --rpc-url "$HEDERA_RPC_URL")
BALANCE_TINYBAR=$(python3 -c "print($BALANCE_WEIBAR // 10000000000)")
echo "  operator $OPERATOR_PUBLIC_KEY holds $BALANCE_TINYBAR tinybars ($(python3 -c "print(f'{$BALANCE_TINYBAR/100000000:.2f}')") HBAR)"
# Deploying three contracts plus one wiring call is a few hundred thousand gas total at typical Hedera gas
# prices; 5 HBAR is a generous, cheap-to-check ceiling that catches "clearly not funded" before spending.
MIN_TINYBAR=500000000
if [ "$BALANCE_TINYBAR" -lt "$MIN_TINYBAR" ]; then
  echo "ABORTING: balance is below the $((MIN_TINYBAR / 100000000)) HBAR preflight floor for this sequence." >&2
  echo "Fund $OPERATOR_PUBLIC_KEY from a Hedera testnet faucet before retrying." >&2
  exit 1
fi

deploy() {
  local label="$1"
  local contract="$2"
  shift 2
  echo "== Deploying $label ==" >&2
  local out
  out=$(forge create "$contract" --rpc-url "$HEDERA_RPC_URL" --private-key "$PK" --broadcast --json "$@")
  local address
  address=$(echo "$out" | python3 -c "import json,sys; print(json.load(sys.stdin)['deployedTo'])")
  local tx
  tx=$(echo "$out" | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
  echo "  $label deployed at $address (tx $tx)" >&2
  echo "$address"
}

TREASURY=$(deploy "JurorTreasury" "src/jury/JurorTreasury.sol:JurorTreasury" \
  --constructor-args "$OPERATOR_PUBLIC_KEY" "$WITHDRAWAL_CAP" "$WITHDRAWAL_WINDOW")

RESOLVER=$(deploy "NyayaResolver" "src/jury/NyayaResolver.sol:NyayaResolver" \
  --constructor-args "$TREASURY" "$OPERATOR_PUBLIC_KEY")

echo "== Wiring: treasury.setResolver(resolver) ==" >&2
WIRE_TX=$(cast send "$TREASURY" "setResolver(address)" "$RESOLVER" \
  --rpc-url "$HEDERA_RPC_URL" --private-key "$PK" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "  setResolver tx $WIRE_TX" >&2

MARKET=$(deploy "JurorShareMarket" "src/shares/JurorShareMarket.sol:JurorShareMarket" \
  --constructor-args "$RESOLVER" "$TREASURY" "$OPERATOR_PUBLIC_KEY")

ANCHOR_JSON_PATH="deployments/hedera.json"
python3 - "$ANCHOR_JSON_PATH" "$TREASURY" "$RESOLVER" "$MARKET" <<'PYEOF'
import json, sys
path, treasury, resolver, market = sys.argv[1:5]
try:
    existing = json.load(open(path))
except FileNotFoundError:
    existing = {}
# Unconditional overwrite of the contracts this run deployed; ats/shareTokens/distributors carried
# forward as-is (this run doesn't touch ATS-issued tokens or per-juror distributors).
existing["chainId"] = 296
existing["contracts"] = {
    "JurorTreasury": treasury,
    "NyayaResolver": resolver,
    "JurorShareMarket": market,
}
json.dump(existing, open(path, "w"), indent=2)
open(path, "a").write("\n")
PYEOF

echo ""
echo "Deployed and wired. deployments/hedera.json overwritten with:"
echo "  JurorTreasury:    $TREASURY"
echo "  NyayaResolver:    $RESOLVER"
echo "  JurorShareMarket: $MARKET"
