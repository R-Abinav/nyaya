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
 *
 * Calls the real evidence service with live data from free public APIs.
 * In production, this would also:
 * - Withdraw x402 payment from juror treasury
 * - Pay the Evidence Gateway
 * - Log payment on-chain
 */
async function executeToolCall(toolCall, caseId, jurorId) {
  const { executeEvidenceTool } = require('./evidenceService');

  const toolName = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments || '{}');

  console.log(`[${jurorId}] Executing tool: ${toolName}`, args);

  try {
    // Call real evidence service
    const result = await executeEvidenceTool(toolName, args);

    // TODO: Wire real x402 payments
    // const payment = await withdrawFromTreasury(jurorId, caseId, TOOL_COST);
    // const settlement = await payEvidenceGateway(toolName, payment);

    const mockCost = 0.01; // HBAR per call

    return {
      toolName,
      args,
      cost: mockCost,
      result,
    };
  } catch (error) {
    console.error(`[${jurorId}] Tool execution failed:`, error.message);

    // Return error but don't crash the investigation
    return {
      toolName,
      args,
      cost: 0,
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
 * Get tools for different case types
 * Loads from real evidence service API endpoints
 */
function getMockToolsForCaseType(caseType) {
  const toolsByType = {
    'rocket-launch': [
      {
        type: 'function',
        function: {
          name: 'get_launch_status',
          description: 'Get current status of a rocket launch from Launch Library 2 (thespacedevs.com). Returns launch name, status, window times, probability, hold/fail reasons, and pad information.',
          parameters: {
            type: 'object',
            properties: {
              launchId: {
                type: 'string',
                description: 'Launch ID from Launch Library 2 (e.g., "f4b6c4c0-42c4-4b9d-8c6f-4c9b9b9b9b9b")',
              },
            },
            required: ['launchId'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_launch_pad_history',
          description: 'Get historical launch data for a specific launch pad to assess reliability. Returns recent launches from this pad with their outcomes.',
          parameters: {
            type: 'object',
            properties: {
              padId: {
                type: 'string',
                description: 'Launch pad ID from Launch Library 2',
              },
              limit: {
                type: 'number',
                description: 'Number of historical launches to retrieve (default: 10, max: 20)',
                default: 10,
              },
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
          description: 'Get real-time flight status from OpenSky Network using ADS-B data. Returns current position, altitude, velocity, and ground status.',
          parameters: {
            type: 'object',
            properties: {
              icao24: {
                type: 'string',
                description: 'Aircraft ICAO24 transponder address (6-character hex, e.g., "a1b2c3")',
              },
            },
            required: ['icao24'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get current weather conditions from Open-Meteo for departure or arrival location. Returns temperature, wind speed/direction, and weather code.',
          parameters: {
            type: 'object',
            properties: {
              latitude: {
                type: 'number',
                description: 'Latitude in decimal degrees',
              },
              longitude: {
                type: 'number',
                description: 'Longitude in decimal degrees',
              },
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
          description: 'Get current star count and repository metrics from GitHub API. Returns stars, forks, watchers, open issues, and update timestamps.',
          parameters: {
            type: 'object',
            properties: {
              owner: {
                type: 'string',
                description: 'Repository owner username (e.g., "facebook")',
              },
              repo: {
                type: 'string',
                description: 'Repository name (e.g., "react")',
              },
            },
            required: ['owner', 'repo'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_repo_activity',
          description: 'Get recent commit activity metrics for the repository to assess momentum. Returns weekly commit counts for trend analysis.',
          parameters: {
            type: 'object',
            properties: {
              owner: {
                type: 'string',
                description: 'Repository owner username',
              },
              repo: {
                type: 'string',
                description: 'Repository name',
              },
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
