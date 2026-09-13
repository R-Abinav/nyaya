const { OPENROUTER_API_KEY, OPENROUTER_API_URL } = require('../config/env');
const { getJuror } = require('../config/jurors');
const { getResolverContract, getResolverAsSigner, getJurorSigner, assertFunctionsExist, readAbi } = require('../config/contracts');
const { ethers } = require('ethers');
const crypto = require('crypto');

/** Mirrors NyayaResolver.Ruling exactly (None=0, No=1, Yes=2). Never reorder — abi.encode writes it as
 *  this index, and the live contract's commitmentFor() must decode the same values. */
const Ruling = { None: 0, No: 1, Yes: 2 };

/** Below this confidence, the agent declines to commit for the case rather than stake on a low-conviction
 *  ruling. The evidence spend already happened (via withdrawForEvidence) and stands as a real, accepted
 *  loss regardless — no stake ever locks either way, since staking only happens at commit. Named and
 *  exported so callers (and the docs) reference one number, not a copy of "4000" scattered around. */
const CONFIDENCE_THRESHOLD_BPS = 4000; // 40%

/**
 * Juror Agent Service
 *
 * Implements the reasoning loop for AI juror agents that:
 * - Investigate cases by calling evidence tools
 * - Track x402 spend per tool call
 * - Decide when evidence is sufficient vs too costly
 * - Generate commit-reveal commitments with fraction-scaled stakes
 * - Pin evidence trails to IPFS after commit deadline
 */

// Model configuration - all jurors use NVIDIA Nemotron
const MODEL = 'nvidia/nemotron-3.5-lightning:free';

/**
 * Sends a request to OpenRouter API
 */
async function sendLLMRequest(messages, tools) {
  const requestBody = {
    model: MODEL,
    messages,
    tools: tools || [],
    tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
  };

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Nyaya Juror Agent',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`OpenRouter error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  return data;
}

/** Cached per-juror Hedera account id for the hot wallet paying real x402 calls (mirror-node lookup, done
 *  once per juror per process — see x402HederaClient.js's resolveHederaAccountId). */
const hotWalletAccountIdCache = new Map();

/**
 * Real evidence tools go through a genuine x402 payment; every non-real one still uses the dummy
 * approve-then-call path. Currently only 'search_news' is wired to the real flow — see
 * x402HederaGateway.js's own comment for why this is a deliberate scope cut, not an oversight: it's the
 * one tool shared by every case type, and every other evidence call (get_launch_status, get_flight_status,
 * get_weather, get_repo_stars, get_repo_activity) stays a direct in-process fetch for now.
 */
const REAL_X402_TOOLS = new Set(['search_news']);

/** 0.01 HBAR per call — the same nominal per-call cost DUMMY_X402_COST_HBAR already used, now a real
 *  on-chain amount moved for every evidence call, whether or not that call also pays a real x402 charge
 *  afterward (only search_news does today). */
const EVIDENCE_WITHDRAWAL_TINYBAR = 1_000_000n;

/**
 * Moves real HBAR from the juror's treasury to its hot wallet, tagged with this case id, via
 * NyayaResolver.withdrawForEvidence — exactly the mechanism .claude/rules/agent.md specifies for every
 * evidence call, not only the ones that also pay a real x402 charge. Settlement reads a juror's x402Spend
 * only from these case-tagged withdrawals, so this is what makes "evidence spend stands as the loss" (for
 * a juror that later declines) and a committing juror's net-profit accounting literally true on-chain,
 * rather than a number only ever reported in an HTTP response.
 */
async function withdrawForEvidenceOnChain(jurorId, caseId) {
  const juror = getJuror(jurorId);
  const jurorSigner = getJurorSigner(juror);
  const resolver = getResolverAsSigner(jurorSigner);
  const tx = await resolver.withdrawForEvidence(caseId, EVIDENCE_WITHDRAWAL_TINYBAR);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`withdrawForEvidence reverted on-chain in ${tx.hash}`);
  return { txHash: tx.hash, amountTinybar: EVIDENCE_WITHDRAWAL_TINYBAR };
}

async function executeRealX402ToolCall(toolName, args, jurorId) {
  const { createHederaPayingFetch, resolveHederaAccountId } = require('./x402HederaClient');
  const { getJuror } = require('../config/jurors');
  const env = require('../config/env');

  const juror = getJuror(jurorId);
  const hotWalletPrivateKey = env[juror.hotWalletPrivateKeyEnv];
  if (!hotWalletPrivateKey) {
    throw new Error(`${juror.hotWalletPrivateKeyEnv} is not set in backend/.env — required to pay real x402 evidence calls.`);
  }

  let accountId = hotWalletAccountIdCache.get(juror.hotWallet);
  if (!accountId) {
    accountId = await resolveHederaAccountId(juror.hotWallet);
    hotWalletAccountIdCache.set(juror.hotWallet, accountId);
  }

  const payingFetch = createHederaPayingFetch(accountId, hotWalletPrivateKey);
  const params = new URLSearchParams(args);
  const baseUrl = env.EVIDENCE_GATEWAY_BASE_URL;
  const response = await payingFetch(`${baseUrl}/evidence/search-news?${params.toString()}`);

  const paymentResponseHeader = response.headers.get('payment-response') || response.headers.get('x-payment-response');
  let settlement = null;
  if (paymentResponseHeader) {
    settlement = JSON.parse(Buffer.from(paymentResponseHeader, 'base64').toString('utf8'));
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Evidence gateway returned ${response.status}: ${body}`);
  }

  const result = await response.json();
  return { result, settlement };
}

/**
 * Execute a tool call
 *
 * Every real evidence call is preceded by a real, on-chain, case-tagged NyayaResolver.withdrawForEvidence
 * from the juror's own treasury (withdrawForEvidenceOnChain) — this is what makes the reported spend real
 * money that actually left the treasury, not just a number in a response. 'search_news' additionally pays
 * through a genuine x402 flow on top of that withdrawal — a real HTTP 402 challenge, a real signed payment
 * from the juror's own hot wallet, real settlement via the Blocky402 facilitator on Hedera testnet,
 * verified independently against the mirror node during development (see docs/TESTNET-EVIDENCE.md). Every
 * other evidence tool still uses the dummy approve-then-call path below for the upstream call itself (a
 * deliberate, named scope cut, not an oversight — see REAL_X402_TOOLS's comment) — only the treasury
 * withdrawal in front of it is real for those too.
 */
async function executeToolCall(toolCall, caseId, jurorId) {
  const { executeEvidenceTool } = require('./evidenceService');
  const { approveEvidencePayment } = require('./x402Gateway');

  const toolName = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments || '{}');

  console.log(`[${jurorId}] Executing tool: ${toolName}`, args);

  let withdrawal;
  try {
    withdrawal = await withdrawForEvidenceOnChain(jurorId, caseId);
    console.log(`[${jurorId}] withdrew ${withdrawal.amountTinybar} tinybar for evidence, tx ${withdrawal.txHash}`);
  } catch (error) {
    console.error(`[${jurorId}] withdrawForEvidence reverted:`, error.message);
    return {
      toolName,
      args,
      cost: 0,
      paymentStatus: 'rejected',
      payment: { approved: false, mode: 'onchain_withdrawal_failed', error: error.message, rejectedAt: new Date().toISOString() },
      result: { error: error.message, timestamp: new Date().toISOString() },
    };
  }

  if (REAL_X402_TOOLS.has(toolName)) {
    try {
      const { result, settlement } = await executeRealX402ToolCall(toolName, args, jurorId);
      const costHbar = settlement ? 0.01 : 0; // matches x402HederaGateway.js's SEARCH_NEWS_PRICE_TINYBAR
      return {
        toolName,
        args,
        cost: costHbar,
        paymentStatus: settlement?.success ? 'settled_real_x402' : 'settlement_response_missing',
        payment: settlement,
        withdrawal,
        result,
      };
    } catch (error) {
      console.error(`[${jurorId}] Real x402 tool call failed:`, error.message);
      return {
        toolName,
        args,
        cost: 0,
        paymentStatus: 'rejected',
        payment: { approved: false, mode: 'real_x402', error: error.message, rejectedAt: new Date().toISOString() },
        withdrawal,
        result: { error: error.message, timestamp: new Date().toISOString() },
      };
    }
  }

  let payment;
  try {
    payment = await approveEvidencePayment({ caseId, jurorId, toolName });
    if (!payment.approved) {
      throw new Error('Evidence payment was not approved');
    }

    const result = await executeEvidenceTool(toolName, args);

    return {
      toolName,
      args,
      cost: payment.amount,
      paymentStatus: 'approved_dummy',
      payment,
      withdrawal,
      result,
    };
  } catch (error) {
    console.error(`[${jurorId}] Tool execution failed:`, error.message);

    // Return error but don't crash the investigation
    return {
      toolName,
      args,
      cost: payment?.amount || 0,
      paymentStatus: payment?.approved ? 'approved_dummy_evidence_failed' : 'rejected',
      payment: payment || {
        approved: false,
        mode: 'dummy',
        error: error.message,
        rejectedAt: new Date().toISOString(),
      },
      result: {
        error: error.message,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

/**
 * Agent reasoning loop
 *
 * Given a case, the agent:
 * 1. Loads tools relevant to the case type
 * 2. Iteratively calls tools and evaluates evidence
 * 3. Decides when to stop (sufficient evidence OR not worth the cost)
 * 4. Forms a ruling with betting fraction (what fraction of their stake to bet)
 * 5. Returns verdict, betting fraction, evidence trail, and total spend
 */
async function investigateCase(jurorId, caseData) {
  const juror = getJuror(jurorId);
  const { caseId, question, commitDeadline, caseType: requestedCaseType } = caseData;
  // The agent picks its toolset from the real open case's actual type — never hardcoded. Falls back to
  // general-news only when the caller genuinely doesn't specify one (e.g. the free-text demo endpoint).
  const caseType = requestedCaseType || 'general-news';

  console.log(`\n[${juror.name}] Starting investigation of case ${caseId}`);
  console.log(`[${juror.name}] Question: ${question}`);
  console.log(`[${juror.name}] Case type: ${caseType}`);

  // Evidence trail tracks all tools called and reasoning
  const evidenceTrail = {
    jurorId,
    jurorName: juror.name,
    caseId,
    question,
    caseType,
    investigationStart: new Date().toISOString(),
    toolCalls: [],
    totalSpent: 0,
    reasoning: [],
  };

  const tools = getToolsForCaseType(caseType);
  console.log(`[${juror.name}] offered tools for case type "${caseType}": ${tools.map(t => t.function.name).join(', ')}`);

  const messages = [
    {
      role: 'system',
      content: juror.systemPrompt,
    },
    {
      role: 'user',
      content: `You are investigating this case:

Case ID: ${caseId}
Question: ${question}
Case Type: ${caseType}
Commit Deadline: ${commitDeadline}

Use the available evidence tools to investigate. After each tool call, explicitly decide whether you need more evidence or are ready to rule.

Remember:
- Each tool call costs money from your treasury
- Your net profit = reward - total evidence spend (if correct) or -stake - spend (if incorrect)
- Stop when your ruling and profit-maximizing betting fraction are stable OR when more evidence won't improve them enough to justify the cost

When ready to rule, use this exact format:
Chosen Outcome: <exact label or ID of one available outcome>
Betting Fraction: <number from 0.0 to 1.0>
Reasoning: <why this outcome has the best risk-adjusted expected profit>
Stop Reason: <why more paid news searches are not worth the expected profit improvement>

The betting fraction is the fraction of your maximum stake allocation you choose to risk. It is not a confidence percentage and does not mean you can guarantee profit. A poor NewsData query may return nothing, so choose q, qInTitle, and qInMeta keywords carefully and preserve the most important word order.`,
    },
  ];

  let response;
  let assistantMessage;

  try {
    response = await sendLLMRequest(messages, tools);
    assistantMessage = response.choices[0].message;
  } catch (error) {
    if (evidenceTrail.totalSpent === 0) {
      throw error;
    }

    console.error(`[ALERT][SpentWithoutRuling] ${jurorId} could not get an initial ruling after spending ${evidenceTrail.totalSpent} HBAR: ${error.message}`);
    assistantMessage = fallbackRuling(error);
  }

  // Tool calling loop - no hard cap, agent decides when to stop
  let iteration = 0;
  const MAX_ITERATIONS = 20; // Safety backstop only

  while (assistantMessage.tool_calls?.length > 0 && iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`\n[${juror.name}] Iteration ${iteration}`);

    messages.push(assistantMessage);

    // Execute all tool calls in this iteration
    for (const toolCall of assistantMessage.tool_calls) {
      const toolResult = await executeToolCall(toolCall, caseId, jurorId);

      evidenceTrail.toolCalls.push(toolResult);
      evidenceTrail.totalSpent += toolResult.cost;

      console.log(`[${juror.name}] Called ${toolResult.toolName}, spent ${toolResult.cost} HBAR (total: ${evidenceTrail.totalSpent})`);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult.result),
      });
    }

    // Ask agent to continue or make final ruling
    console.log(`[${juror.name}] Asking for next decision...`);
    try {
      response = await sendLLMRequest(messages, tools);
      assistantMessage = response.choices[0].message;
    } catch (error) {
      console.error(`[ALERT][SpentWithoutRuling] ${jurorId} could not continue after spending ${evidenceTrail.totalSpent} HBAR: ${error.message}`);
      assistantMessage = fallbackRuling(error);
      break;
    }
  }

  function fallbackRuling(error) {
    return {
      role: 'assistant',
      content: [
        'Chosen Outcome: undetermined',
        'Betting Fraction: 0.0',
        `Reasoning: Evidence was gathered, but the ruling model failed before completing its analysis (${error.message}).`,
        'Stop Reason: Further evidence is not justified after the model failure.',
      ].join('\n'),
    };
  }

  if (iteration >= MAX_ITERATIONS) {
    console.warn(`[${juror.name}] Hit max iterations backstop`);
  }

  // Extract final ruling
  messages.push(assistantMessage);
  evidenceTrail.investigationEnd = new Date().toISOString();
  evidenceTrail.finalAnalysis = assistantMessage.content;

  console.log(`\n[${juror.name}] Investigation complete`);
  console.log(`[${juror.name}] Tool calls made: ${evidenceTrail.toolCalls.length}`);
  console.log(`[${juror.name}] Total spent: ${evidenceTrail.totalSpent} HBAR`);
  console.log(`\n[${juror.name}] Final analysis:\n${assistantMessage.content}\n`);

  // Parse verdict, betting fraction, reasoning and stop reason from final response. The reasoning trail
  // needs "why it stopped" and "why confidence stayed low" as structured fields, not just the raw content
  // blob, so a decline can be audited without re-parsing free text downstream.
  const { verdict, bettingFraction, reasoning, stopReason } = parseVerdict(assistantMessage.content);
  evidenceTrail.reasoning = reasoning;
  evidenceTrail.stopReason = stopReason;

  return {
    jurorId,
    jurorName: juror.name,
    caseId,
    verdict,
    bettingFraction,
    evidenceTrail,
    totalSpent: evidenceTrail.totalSpent,
  };
}

/**
 * Parse verdict, betting fraction, reasoning and stop reason from agent's final response
 */
function parseVerdict(content) {
  // A real failure mode, not hypothetical: an LLM response can come back with tool_calls empty/absent AND
  // content null (no usable text at all), which used to crash here with "Cannot read properties of null".
  // Treat it the same as parseVerdict finding no recognizable fields: undetermined verdict, zero betting
  // fraction — which correctly routes to a decline via the confidence threshold, rather than crashing the
  // whole investigation (and, in a multi-juror Promise.all, every other juror's already-real on-chain
  // evidence withdrawals along with it).
  if (!content) {
    return { verdict: 'undetermined', selectedOutcome: 'undetermined', bettingFraction: 0, reasoning: null, stopReason: 'Model returned no content.' };
  }

  // A real bug, caught after it had already changed a real on-chain stake: the model often wraps field
  // labels in markdown emphasis ("**Betting Fraction:** 0.97"), and every regex below assumed the label is
  // followed immediately by ":"/whitespace. The "**" between the label and ":" silently defeated the match,
  // which fell through to the 0.5 default — recorded and staked as 5000bps for a juror that had actually
  // said 9700bps. Stripping markdown emphasis once, up front, fixes every field's parsing at the same root
  // cause rather than patching each regex separately.
  content = content.replace(/[*_]{1,2}/g, '');

  // Extract betting fraction (0.0 to 1.0)
  let bettingFraction = 0.5; // default
  const bettingFractionMatch = content.match(/betting fraction[:\s]+(\d+\.?\d*)/i) ||
                               content.match(/fraction[:\s]+(\d+\.?\d*)/i) ||
                               content.match(/bet[:\s]+(\d+\.?\d*)/i);
  if (bettingFractionMatch) {
    let fraction = parseFloat(bettingFractionMatch[1]);
    // Ensure it's between 0 and 1
    if (fraction > 1) fraction = fraction / 100; // Convert percentage to fraction if needed
    bettingFraction = Math.max(0, Math.min(1, fraction)); // Clamp between 0 and 1
  }

  const outcomeMatch = content.match(/chosen outcome[:\s]+(.+)/i) ||
                       content.match(/selected outcome[:\s]+(.+)/i);
  const selectedOutcome = outcomeMatch ? outcomeMatch[1].split(/\r?\n/)[0].trim() : 'undetermined';

  const reasoningMatch = content.match(/reasoning[:\s]+(.+?)(?:\r?\n(?:stop reason|chosen outcome|betting fraction)[:\s]|$)/is);
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : null;

  const stopReasonMatch = content.match(/stop reason[:\s]+(.+?)(?:\r?\n(?:reasoning|chosen outcome|betting fraction)[:\s]|$)/is);
  const stopReason = stopReasonMatch ? stopReasonMatch[1].trim() : null;

  return { verdict: selectedOutcome, selectedOutcome, bettingFraction, reasoning, stopReason };
}

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

/**
 * Commitment = keccak256(abi.encode(caseId, juror, ruling, confidenceBps, salt)), matching
 * .claude/rules/contracts.md and NyayaResolver.commitmentFor() exactly:
 *   - caseId:       uint256
 *   - juror:        address
 *   - ruling:       uint8  (the Ruling enum's index — 0=None, 1=No, 2=Yes; never a text label)
 *   - confidenceBps: uint16 (basis points, 0-10000 — never a percentage string)
 *   - salt:         bytes32
 *
 * Verified against the live resolver's own commitmentFor() with real matching inputs in
 * verifyCommitmentAgainstResolver() below; this is the same encoding, not a re-implementation that merely
 * looks similar.
 */
function generateCommitment(caseId, jurorAddress, ruling, confidenceBps, salt) {
  if (!Number.isInteger(ruling) || ruling < Ruling.None || ruling > Ruling.Yes) {
    throw new Error(`ruling must be the Ruling enum's numeric index (0-2), got ${ruling}`);
  }
  if (!Number.isInteger(confidenceBps) || confidenceBps < 0 || confidenceBps > 10000) {
    throw new Error(`confidenceBps must be an integer 0-10000, got ${confidenceBps}`);
  }
  const encoded = abiCoder.encode(
    ['uint256', 'address', 'uint8', 'uint16', 'bytes32'],
    [caseId, jurorAddress, ruling, confidenceBps, salt],
  );
  return ethers.keccak256(encoded);
}

/**
 * Maps the agent's free-text verdict onto the binary Ruling enum the contract actually uses. The current
 * investigation prompt still asks for a "Chosen Outcome" label (a holdover from the discarded multi-option
 * betting design — see docs/TESTNET-EVIDENCE.md's audit notes); every real case type in the guide
 * (rocket launch, flight delay, GitHub stars) is a yes/no question underneath, so this maps onto that.
 * Anything that isn't recognizably yes/no returns Ruling.None, which the contract can never accept as a
 * reveal — the caller must treat that the same as low confidence: spend was real, but the juror does not
 * commit.
 */
function mapVerdictToRuling(verdictText) {
  const normalized = String(verdictText || '').trim().toLowerCase();
  if (['yes', 'true', 'succeed', 'succeeded', 'on-time', 'met'].some(word => normalized.includes(word))) {
    return Ruling.Yes;
  }
  if (['no', 'false', 'fail', 'failed', 'delayed', 'not met', 'undetermined'].some(word => normalized.includes(word))) {
    return Ruling.No;
  }
  return Ruling.None;
}

/**
 * Confirms generateCommitment() produces exactly what the live resolver's own commitmentFor() would —
 * the real check, not a read-through comparison. Throws on any mismatch.
 */
async function verifyCommitmentAgainstResolver({ caseId, jurorAddress, ruling, confidenceBps, salt }) {
  const resolverAbi = readAbi('NyayaResolver');
  assertFunctionsExist(resolverAbi, ['commitmentFor'], 'NyayaResolver');
  const resolver = getResolverContract();
  const onChain = await resolver.commitmentFor(caseId, jurorAddress, ruling, confidenceBps, salt);
  const local = generateCommitment(caseId, jurorAddress, ruling, confidenceBps, salt);
  if (onChain.toLowerCase() !== local.toLowerCase()) {
    throw new Error(`Commitment mismatch: local ${local} != on-chain commitmentFor() ${onChain}`);
  }
  return { local, onChain, matches: true };
}

/**
 * Generate a random salt for commit-reveal
 */
function generateSalt() {
  return `0x${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * Calculate stake based on betting fraction (Kelly-style sizing)
 *
 * This is an agent policy, not enforced by contract.
 * Higher betting fraction = larger stake.
 */
function calculateStake(bettingFraction, treasuryBalance) {
  // Simple linear scaling: stake = bettingFraction * maxStake
  // where maxStake = 20% of treasury (conservative Kelly)
  const maxStakeFraction = 0.20;
  const stake = bettingFraction * maxStakeFraction * treasuryBalance;
  return Math.max(0.1, stake); // Minimum 0.1 HBAR
}

const NEWS_TOOL = {
  type: 'function',
  function: {
    name: 'search_news',
    description: 'Search NewsData.io latest English news. Use exact, carefully ordered keywords. Only q, qInTitle, or qInMeta may be provided; image, video, removeduplicate, language, and all other URL parameters are fixed.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Exact ordered keywords across article content.' },
        qInTitle: { type: 'string', description: 'Exact ordered keywords in the title.' },
        qInMeta: { type: 'string', description: 'Exact ordered keywords in metadata.' },
      },
      additionalProperties: false,
    },
  },
};

/**
 * The real, case-type-specific tools from evidenceService.js. Previously unreachable: investigateCase
 * hardcoded caseType to 'general-news' and always offered only NEWS_TOOL, so these existed but were dead
 * code from the agent's perspective. Every tool name here has a matching entry in
 * evidenceService.js's executeEvidenceTool dispatch table.
 */
const TOOLS_BY_CASE_TYPE = {
  'rocket-launch': [
    {
      type: 'function',
      function: {
        name: 'get_launch_status',
        description: 'Get the current status of a specific rocket launch from Launch Library 2.',
        parameters: {
          type: 'object',
          properties: { launchId: { type: 'string', description: 'The Launch Library 2 launch id.' } },
          required: ['launchId'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_launch_pad_history',
        description: 'Get recent launch history for a specific pad, useful for base-rate context.',
        parameters: {
          type: 'object',
          properties: {
            padId: { type: 'string', description: 'The Launch Library 2 pad id.' },
            limit: { type: 'integer', minimum: 1, maximum: 20 },
          },
          required: ['padId'],
          additionalProperties: false,
        },
      },
    },
    NEWS_TOOL,
  ],
  'flight-delay': [
    {
      type: 'function',
      function: {
        name: 'get_flight_status',
        description: 'Get live flight status from OpenSky Network by ICAO24 transponder address.',
        parameters: {
          type: 'object',
          properties: { icao24: { type: 'string', description: 'The aircraft ICAO24 transponder hex address.' } },
          required: ['icao24'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get current weather at a location from Open-Meteo, useful for delay context.',
        parameters: {
          type: 'object',
          properties: {
            latitude: { type: 'number' },
            longitude: { type: 'number' },
          },
          required: ['latitude', 'longitude'],
          additionalProperties: false,
        },
      },
    },
    NEWS_TOOL,
  ],
  'github-stars': [
    {
      type: 'function',
      function: {
        name: 'get_repo_stars',
        description: 'Get the current star count and related metadata for a GitHub repository.',
        parameters: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
          },
          required: ['owner', 'repo'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_repo_activity',
        description: 'Get recent commit activity for a GitHub repository, useful for momentum context.',
        parameters: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
          },
          required: ['owner', 'repo'],
          additionalProperties: false,
        },
      },
    },
    NEWS_TOOL,
  ],
  'general-news': [NEWS_TOOL],
};

function getToolsForCaseType(caseType) {
  return TOOLS_BY_CASE_TYPE[caseType] || TOOLS_BY_CASE_TYPE['general-news'];
}

module.exports = {
  Ruling,
  CONFIDENCE_THRESHOLD_BPS,
  investigateCase,
  generateCommitment,
  mapVerdictToRuling,
  verifyCommitmentAgainstResolver,
  generateSalt,
  calculateStake,
};
