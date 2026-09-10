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
 * - Generate commit-reveal commitments with confidence-scaled stakes
 * - Pin evidence trails to IPFS after commit deadline
 */

// Model configuration - all jurors use NVIDIA Nemotron
const MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct';

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
 * In production, this would:
 * - Withdraw x402 payment from juror treasury
 * - Pay the Evidence Gateway
 * - Return the evidence data
 *
 * For now, this is a placeholder that simulates the structure
 */
async function executeToolCall(toolCall, caseId, jurorId) {
  const toolName = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments || '{}');

  console.log(`[${jurorId}] Executing tool: ${toolName}`, args);

  // TODO: Wire real x402 payments to Evidence Gateway
  // const payment = await withdrawFromTreasury(jurorId, caseId, TOOL_COST);
  // const evidence = await callEvidenceGateway(toolName, args, payment);

  // Simulate tool execution for now
  const mockCost = 0.01; // HBAR per call

  return {
    toolName,
    args,
    cost: mockCost,
    result: {
      // TODO: Replace with real Evidence Gateway responses
      placeholder: `Mock result for ${toolName}`,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Agent reasoning loop
 *
 * Given a case, the agent:
 * 1. Loads tools relevant to the case type
 * 2. Iteratively calls tools and evaluates evidence
 * 3. Decides when to stop (sufficient evidence OR not worth the cost)
 * 4. Forms a ruling with confidence
 * 5. Returns verdict, confidence, evidence trail, and total spend
 */
async function investigateCase(jurorId, caseData) {
  const juror = getJuror(jurorId);
  const { caseId, question, caseType, commitDeadline } = caseData;

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

  // TODO: Load tools dynamically based on case type
  // For now, use a mock tool set
  const tools = getMockToolsForCaseType(caseType);

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
- Stop when you have sufficient confidence OR when more evidence won't improve your ruling enough to justify the cost

When ready to rule, provide:
1. Your verdict (yes/no or other appropriate answer)
2. Your confidence level (0-100%)
3. Your reasoning for the verdict
4. Your reasoning for stopping investigation at this point`,
    },
  ];

  let response = await sendLLMRequest(messages, tools);
  let assistantMessage = response.choices[0].message;

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
    response = await sendLLMRequest(messages, tools);
    assistantMessage = response.choices[0].message;
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

  // Parse verdict and confidence from final response
  const { verdict, confidence } = parseVerdict(assistantMessage.content);

  return {
    jurorId,
    jurorName: juror.name,
    caseId,
    verdict,
    confidence,
    evidenceTrail,
    totalSpent: evidenceTrail.totalSpent,
  };
}

/**
 * Parse verdict and confidence from agent's final response
 */
function parseVerdict(content) {
  const lower = content.toLowerCase();

  // Extract confidence
  let confidence = 50; // default
  const confidenceMatch = content.match(/confidence[:\s]+(\d+)%?/i);
  if (confidenceMatch) {
    confidence = parseInt(confidenceMatch[1]);
  }

  // Extract verdict
  let verdict = 'no'; // default
  if (lower.includes('verdict: yes') || lower.includes('verdict:yes')) {
    verdict = 'yes';
  } else if (lower.includes('verdict: no') || lower.includes('verdict:no')) {
    verdict = 'no';
  } else if (lower.match(/\byes\b/i) && !lower.match(/\bno\b/i)) {
    verdict = 'yes';
  }

  return { verdict, confidence };
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
 * Calculate stake based on confidence (Kelly-style sizing)
 *
 * This is an agent policy, not enforced by contract.
 * Higher confidence = larger stake.
 */
function calculateStake(confidence, treasuryBalance) {
  // Simple linear scaling: stake = (confidence/100) * maxStake
  // where maxStake = 20% of treasury (conservative Kelly)
  const maxStakeFraction = 0.20;
  const stake = (confidence / 100) * maxStakeFraction * treasuryBalance;
  return Math.max(0.1, stake); // Minimum 0.1 HBAR
}

/**
 * Mock tools for different case types
 * TODO: Replace with dynamic loading from Evidence Gateway registry
 */
function getMockToolsForCaseType(caseType) {
  const toolsByType = {
    'rocket-launch': [
      {
        type: 'function',
        function: {
          name: 'get_launch_status',
          description: 'Get current status of a rocket launch from Launch Library 2',
          parameters: {
            type: 'object',
            properties: {
              launchId: { type: 'string', description: 'Launch ID' },
            },
            required: ['launchId'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_launch_history',
          description: 'Get historical launch data for the launch pad',
          parameters: {
            type: 'object',
            properties: {
              padId: { type: 'string', description: 'Launch pad ID' },
            },
            required: ['padId'],
          },
        },
      },
    ],
    'flight-delay': [
      {
        type: 'function',
        function: {
          name: 'get_flight_status',
          description: 'Get real-time flight status from OpenSky Network',
          parameters: {
            type: 'object',
            properties: {
              icao24: { type: 'string', description: 'Aircraft ICAO24 identifier' },
            },
            required: ['icao24'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather data for departure or arrival airport',
          parameters: {
            type: 'object',
            properties: {
              latitude: { type: 'number' },
              longitude: { type: 'number' },
            },
            required: ['latitude', 'longitude'],
          },
        },
      },
    ],
    'github-stars': [
      {
        type: 'function',
        function: {
          name: 'get_repo_stars',
          description: 'Get current star count for a GitHub repository',
          parameters: {
            type: 'object',
            properties: {
              owner: { type: 'string', description: 'Repository owner' },
              repo: { type: 'string', description: 'Repository name' },
            },
            required: ['owner', 'repo'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_repo_activity',
          description: 'Get recent activity metrics for the repository',
          parameters: {
            type: 'object',
            properties: {
              owner: { type: 'string' },
              repo: { type: 'string' },
            },
            required: ['owner', 'repo'],
          },
        },
      },
    ],
  };

  return toolsByType[caseType] || [];
}

module.exports = {
  investigateCase,
  generateCommitment,
  generateSalt,
  calculateStake,
};
