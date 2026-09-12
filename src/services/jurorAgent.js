const { OPENROUTER_API_KEY, OPENROUTER_API_URL } = require('../config/env');
const { getJuror } = require('../config/jurors');
const crypto = require('crypto');

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

/**
 * Execute a tool call
 *
 * Approves a temporary x402 payment before calling the live evidence service.
 * The payment adapter is intentionally marked dummy until the Hedera contract
 * and gateway API are available.
 */
async function executeToolCall(toolCall, caseId, jurorId) {
  const { executeEvidenceTool } = require('./evidenceService');
  const { approveEvidencePayment } = require('./x402Gateway');

  const toolName = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments || '{}');
  let payment;

  console.log(`[${jurorId}] Executing tool: ${toolName}`, args);

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
  const { caseId, question, commitDeadline } = caseData;
  const caseType = 'general-news';

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

  // General cases use only the NewsData.io search tool; no special identifier is needed.
  const tools = getNewsTools();

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

  // Parse verdict and betting fraction from final response
  const { verdict, bettingFraction } = parseVerdict(assistantMessage.content);

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
 * Parse verdict and betting fraction from agent's final response
 */
function parseVerdict(content) {
  const lower = content.toLowerCase();

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

  return { verdict: selectedOutcome, selectedOutcome, bettingFraction };
}

/**
 * Generate commit hash for commit-reveal
 *
 * Commitment = keccak256(abi.encode(caseId, jurorAddress, ruling, confidence, salt))
 */
function generateCommitment(caseId, jurorAddress, ruling, confidence, salt) {
  // In production, use proper ABI encoding matching the Solidity contract
  // For now, simple concatenation
  const data = `${caseId}:${jurorAddress}:${ruling}:${confidence}:${salt}`;
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  return `0x${hash}`;
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

/**
 * General juror investigations use only NewsData.io, so they do not need
 * source-specific IDs such as launch IDs, ICAO transponders, or repo names.
 */
function getNewsTools() {
  return [
    {
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
    },
  ];
}

module.exports = {
  investigateCase,
  generateCommitment,
  generateSalt,
  calculateStake,
};
