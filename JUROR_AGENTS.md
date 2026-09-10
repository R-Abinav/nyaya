# Nyaya Juror Agents

Three AI juror agents with distinct personalities that independently investigate cases in the Nyaya prediction market.

## The Three Jurors

All three jurors run **NVIDIA Nemotron** via OpenRouter. They differ in their system prompts, evidence thresholds, and tool preferences - not in the underlying model.

### 1. The Skeptic (Conservative, Evidence-Demanding)

**Personality:**
- Demands high-quality, cross-verified evidence before committing
- Will investigate deeply and spend more on evidence to be certain
- Only stakes high when multiple independent sources agree
- Prefers primary sources over secondary commentary

**Strategy:**
- Always calls multiple tools to cross-check facts
- Weighs conflicting evidence carefully
- Questions the reliability and recency of each data point
- Maximum confidence: 95% (never 100% - there's always uncertainty)

**Expected Behavior:**
- Typically makes 3-5 tool calls per case
- Higher evidence spend but lower variance in returns
- Conservative confidence levels even with strong evidence

### 2. The Pragmatist (Balanced, Efficiency-Focused)

**Personality:**
- Seeks the optimal evidence-to-cost ratio
- Makes calculated decisions about when evidence is "good enough"
- Moderate risk tolerance
- Values clear, actionable data over exhaustive research

**Strategy:**
- Gathers sufficient evidence to form a well-informed ruling
- Prioritizes high-value tools that provide clear signals
- Cross-checks important facts, accepts single reliable sources for secondary details
- Maximum confidence: 90%

**Expected Behavior:**
- Typically makes 2-3 tool calls per case
- Balanced spend and moderate confidence
- Stops when signal is clear, doesn't chase perfection

### 3. The Maverick (Aggressive, Intuition-Driven)

**Personality:**
- Makes bold calls with limited evidence
- Trusts pattern recognition and early signals
- Willing to stake high on strong intuitions
- Prefers speed and decisiveness over exhaustive analysis

**Strategy:**
- Gathers enough evidence to form a strong intuition, then commits
- Looks for leading indicators and early signals
- Trusts single high-quality authoritative sources
- Maximum confidence: 99%

**Expected Behavior:**
- Typically makes 1-2 tool calls per case
- Lower evidence spend but higher variance
- Willing to express very high confidence on strong signals

## API Endpoints

### Run Investigation with All Jurors

```bash
POST /juror/investigate
```

**Request Body:**
```json
{
  "question": "Will SpaceX Starship flight 6 launch successfully on its scheduled date?",
  "caseType": "rocket-launch",
  "caseId": "case_001"
}
```

**Supported Case Types:**
- `rocket-launch` - Launch Library 2 data
- `flight-delay` - OpenSky Network + Open-Meteo
- `github-stars` - GitHub API

**Response:**
```json
{
  "caseId": "case_001",
  "question": "Will SpaceX Starship flight 6 launch successfully?",
  "caseType": "rocket-launch",
  "commitDeadline": "2026-09-11T20:43:17.833Z",
  "jurors": [
    {
      "jurorId": "skeptic",
      "jurorName": "The Skeptic",
      "verdict": "yes",
      "confidence": 78,
      "stake": 156.0,
      "totalSpent": 0.04,
      "toolCallCount": 4,
      "commitment": "0x7a9f3c2e1b4d...",
      "salt": "0x4a8b2c...",
      "analysis": "Based on cross-verified evidence from multiple sources..."
    },
    {
      "jurorId": "pragmatist",
      "jurorName": "The Pragmatist",
      "verdict": "yes",
      "confidence": 82,
      "stake": 164.0,
      "totalSpent": 0.03,
      "toolCallCount": 3,
      "analysis": "Clear signal from reliable sources..."
    },
    {
      "jurorId": "maverick",
      "jurorName": "The Maverick",
      "verdict": "yes",
      "confidence": 91,
      "stake": 182.0,
      "totalSpent": 0.02,
      "toolCallCount": 2,
      "analysis": "Strong early indicators point to success..."
    }
  ],
  "summary": {
    "totalJurors": 3,
    "verdicts": {
      "yes": 3,
      "no": 0
    },
    "averageConfidence": "83.7",
    "totalToolCalls": 9,
    "totalSpent": "0.09"
  }
}
```

### Get Juror Information

```bash
GET /juror/info
```

Returns configuration and preferences for all three jurors.

### Get Specific Juror Details

```bash
GET /juror/:jurorId
```

**Parameters:**
- `jurorId`: One of `skeptic`, `pragmatist`, `maverick`

Returns detailed configuration including system prompt for a specific juror.

## How the Reasoning Loop Works

Each juror follows this process:

1. **Receives Case:** Gets the case question, type, and commit deadline
2. **Loads Tools:** Dynamically loads evidence tools relevant to the case type
3. **Reasoning Loop:**
   - Model decides which tool to call (using native tool calling)
   - Tool is executed (with x402 payment in production)
   - Model evaluates evidence and decides: continue or stop?
   - No hard cap - agent decides when evidence is sufficient vs too costly
4. **Forms Verdict:** Determines ruling and confidence level
5. **Calculates Stake:** Confidence-scaled stake (Kelly-style sizing)
6. **Generates Commitment:** `keccak256(caseId, juror, ruling, confidence, salt)`

## Key Implementation Details

### Evidence Spending Discipline

No tool-call cap. The discipline against overspending is economic:

```
net_profit = reward - x402_spend (if correct)
           = -stake - x402_spend (if incorrect)
return = net_profit / (stake + x402_spend)
```

Each tool call reduces net profit, so agents must decide if another call improves their ruling enough to justify the cost.

### Commit-Reveal

- **Commitment hash includes:** caseId + jurorAddress + ruling + confidence + salt
- **Salt persistence:** Salt must be stored durably before committing (lost salt = cannot reveal = slashed)
- **Timing:** Commit before deadline, reveal after

### Confidence-Scaled Staking

Stake calculation (agent policy, not enforced by contract):
```javascript
stake = (confidence / 100) * maxStakeFraction * treasuryBalance
```

Higher confidence → larger stake → larger potential reward (but also larger loss if wrong).

## Configuration

Add to your `.env`:

```bash
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=nvidia/llama-3.1-nemotron-70b-instruct
```

## Running the Server

```bash
npm run dev
```

Server runs on port 3000 by default.

## Example Usage

```bash
# Get juror information
curl http://localhost:3000/juror/info

# Get details for The Skeptic
curl http://localhost:3000/juror/skeptic

# Run investigation with all three jurors
curl -X POST http://localhost:3000/juror/investigate \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Will the SpaceX Falcon 9 launch scheduled for tomorrow proceed on time?",
    "caseType": "rocket-launch"
  }'
```

## What's Implemented

✅ Three distinct juror personalities with different reasoning styles  
✅ System prompts tailored to each personality  
✅ Dynamic tool-calling reasoning loop (no fixed script)  
✅ Economic discipline through spend tracking  
✅ Confidence-scaled stake calculation  
✅ Commit-reveal hash generation  
✅ Salt generation and handling  
✅ Evidence trail tracking  
✅ **Real evidence APIs with live data:**
  - **Launch Library 2** for rocket launches (thespacedevs.com)
  - **OpenSky Network** for flight status (4,000 free credits/day)
  - **Open-Meteo** for weather data (completely free)
  - **GitHub API** for repository metrics (free public API)

## Evidence APIs

All evidence tools call real, live, free public APIs:

### Rocket Launch Tools
- `get_launch_status`: Current launch status from Launch Library 2
- `get_launch_pad_history`: Historical launch data for reliability assessment

### Flight Delay Tools  
- `get_flight_status`: Real-time ADS-B data from OpenSky Network
- `get_weather`: Current weather from Open-Meteo

### GitHub Stars Tools
- `get_repo_stars`: Current star count and repository metrics
- `get_repo_activity`: Recent commit activity for trend analysis

**Test the APIs:**
```bash
node test-evidence-apis.js
```

## What's Next (Production TODOs)

- [ ] Wire real x402 payments to Evidence Gateway
- [ ] Connect to Hedera testnet for treasury and commitment transactions
- [ ] Implement salt persistence (filesystem or database)
- [ ] Add proper ABI encoding for commitment hash (matching Solidity contract)
- [ ] Implement IPFS evidence trail pinning via Pinata
- [ ] Add rate limiting and withdrawal caps
- [ ] Implement resolution checker scripts per case type
- [ ] Add ENS identity integration
- [ ] Build Evidence Gateway with x402 payment middleware

## Architecture Notes

This implementation follows the BUILD-GUIDE specifications:

1. **Actual reasoning, not scripted:** Each case produces different tool call patterns based on the evidence
2. **Three distinct personalities:** Clear differentiation in how each juror approaches investigations
3. **Uncapped spend:** No artificial tool-call limit, agents decide when to stop
4. **Commit-reveal ready:** Hash generation and salt handling implemented
5. **Confidence-scaled stakes:** Kelly-style sizing based on agent confidence
6. **Evidence trails:** Full tracking of what was called, what was learned, and why the agent stopped

## See Also

- `docs/ARCHITECTURE.md` - Full system design and scoring mechanics
- `docs/BUILD-GUIDE.md` - Implementation requirements and build order
- `.claude/rules/agent.md` - Agent-specific development rules
