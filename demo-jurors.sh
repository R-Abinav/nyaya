#!/bin/bash

# Demo script to test the 3 juror agents with different personalities
# Usage: ./demo-jurors.sh

PORT=3001  # Using test server since main server has caching issues

echo "======================================================================"
echo "NYAYA JUROR AGENTS DEMO"
echo "======================================================================"
echo ""

# Test 1: Get all juror information
echo "1. Getting information about all three jurors..."
echo "----------------------------------------------------------------------"
curl -s http://localhost:$PORT/juror/info | jq '.jurors[] | {name, id, toolPreferences}'
echo ""
echo ""

# Test 2: Get detailed info for each juror
echo "2. Detailed personality profiles..."
echo "----------------------------------------------------------------------"

for juror in skeptic pragmatist maverick; do
    echo ""
    echo "=== $juror ==="
    curl -s http://localhost:$PORT/juror/$juror | jq '{name, ensName, confidenceThresholds, toolPreferences}'
    echo ""
done

echo ""
echo "======================================================================"
echo "Demo complete!"
echo ""
echo "To test a full investigation with all 3 jurors, run:"
echo ""
echo 'curl -X POST http://localhost:'$PORT'/juror/investigate \\'
echo '  -H "Content-Type: application/json" \\'
echo '  -d '"'"'{'
echo '    "question": "Will the SpaceX Falcon 9 launch proceed on time?", '
echo '    "caseType": "rocket-launch"'
echo '  }'"'"
echo ""
echo "======================================================================"
