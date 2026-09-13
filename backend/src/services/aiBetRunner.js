const crypto = require('crypto');
const { OPENROUTER_API_KEY, OPENROUTER_API_URL, OPENROUTER_MODEL } = require('../config/env');
const { getJuror, getAllJurorIds } = require('../config/jurors');
const { executeAgentTool, tools } = require('./aiBettingTools');
const logger = require('./logger');
const db = require('../db');

const runs = new Map();

function emit(run, modelId, type, data = {}) {
  const event = { runId: run.id, modelId, type, timestamp: new Date().toISOString(), data };
  run.events.push(event);
  logger.ai(type.toUpperCase(), { runId: run.id, modelId, predictionId: run.predictionId, ...data });
  for (const listener of run.listeners) listener(event);
  db.aiRunEvent.create({ data: { runId: run.id, modelId, type, data } }).catch(error => logger.error('AI_EVENT_PERSIST_FAILED', { runId: run.id, message: error.message }));
}

async function createRun(predictionId, userId, forceBet) {
  const run = { id: `bet_run_${crypto.randomUUID()}`, predictionId, forceBet, events: [], listeners: new Set(), done: false };
  runs.set(run.id, run);
  await db.aiRun.create({ data: { id: run.id, predictionId, userId: userId || null, forceBet } });
  logger.ai('AI_RUN_STARTED', { runId: run.id, predictionId, forceBet });
  return run;
}

async function callModel(messages) {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not configured');
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:5173',
      'X-Title': 'Nyaya AI betting runner',
    },
    body: JSON.stringify({ model: OPENROUTER_MODEL, messages, tools, tool_choice: 'auto' }),
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`OpenRouter returned an unreadable response (${response.status})`); }
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `OpenRouter request failed (${response.status})`);
  return payload.choices?.[0]?.message;
}

function parseFinalResult(content) {
  if (typeof content !== 'string') return null;
  const candidate = content.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed.outcome !== 'string' || typeof parsed.betDecision !== 'string' ||
      typeof parsed.reasoning !== 'string' || typeof parsed.stopReason !== 'string') return null;
    return {
      outcome: parsed.outcome.trim(),
      betDecision: parsed.betDecision.trim(),
      selectedOption: typeof parsed.selectedOption === 'string' ? parsed.selectedOption.trim() : null,
      stake: Number.isFinite(Number(parsed.stake)) ? Number(parsed.stake) : 0,
      reasoning: parsed.reasoning.trim(),
      stopReason: parsed.stopReason.trim(),
    };
  } catch {
    return null;
  }
}

async function runAgent(run, predictionId, modelId) {
  const juror = getJuror(modelId);
  const modelMessages = [
    { role: 'system', content: `${juror.systemPrompt}\n\nYou are executing an AI betting run. Use read_prediction first and research as needed. You may place a bet or decline when mandatory betting mode is off. A successful final response MUST be a JSON object with exactly these useful fields: outcome, betDecision, selectedOption, stake, reasoning, stopReason. Do not reveal private chain-of-thought. Never claim a bet unless the place_prediction_bet tool actually returned success. Mandatory betting mode is ${run.forceBet ? 'ON: you must successfully call place_prediction_bet before completing.' : 'OFF: you may choose not to bet.'}` },
    { role: 'user', content: `Analyze prediction ${predictionId}. Complete the required research and return the structured final result only when your decision is complete.` },
  ];
  emit(run, modelId, 'model_started', { modelName: juror.name, status: 'starting' });
  let apiCost = 0;
  let betStakeCents = 0;
  let finalMessage;
  let finalResult;
  let betPlaced = false;
  let betFailure;
  let placedOption;
  try {
    let iteration = 0;
    while (run.forceBet || iteration < 6) {
      iteration += 1;
      emit(run, modelId, 'status', { status: iteration === 0 ? 'reading_market' : 'thinking' });
      const message = await callModel(modelMessages);
      finalMessage = message;
      modelMessages.push(message);
      if (!message?.tool_calls?.length) {
        finalResult = parseFinalResult(message?.content);
        if (finalResult && (!run.forceBet || betPlaced)) break;
        if (run.forceBet && !betPlaced) {
          logger.ai('MANDATORY_BET_ENFORCEMENT_TRIGGERED', { runId: run.id, modelId, predictionId });
        }
        emit(run, modelId, 'final_result_required', { status: 'continuing' });
        modelMessages.push({
          role: 'user',
          content: run.forceBet && !betPlaced
            ? 'MANDATORY BET MODE: It is compulsory to call place_prediction_bet successfully before completing. Do not return final JSON yet. Select a valid available outcome, choose a valid stake, execute the existing place_prediction_bet tool, and only then return the required data.'
            : 'Your final result format is invalid. It is compulsory to return the required structured data. Return JSON with outcome, betDecision, selectedOption, stake, reasoning, and stopReason. Do not return prose.',
        });
        continue;
      }
      for (const toolCall of message.tool_calls) {
        const name = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments || '{}');
        emit(run, modelId, 'tool_call_started', { tool: name, args, status: 'running' });
        let toolResult;
        try {
          toolResult = await executeAgentTool({ name, args, predictionId, modelId });
        } catch (error) {
          if (name === 'place_prediction_bet') {
            betFailure = error.message;
            emit(run, modelId, 'mandatory_bet_failed', { status: 'failed', reason: error.message });
          }
          throw error;
        }
        apiCost += toolResult.cost;
        const result = toolResult.result;
        if (name === 'place_prediction_bet') {
          betStakeCents = Number(args.amountCents);
          betPlaced = true;
          placedOption = result.option?.label || args.optionId;
          logger.ai('BET_SUCCESSFULLY_PLACED', { runId: run.id, modelId, predictionId, forceBet: run.forceBet, amountCents: betStakeCents });
          emit(run, modelId, 'payment_completed', { status: result.payment?.approved ? 'approved' : 'failed', transaction: result.transaction });
          emit(run, modelId, 'bet_placed', { optionId: args.optionId, amountCents: betStakeCents, status: 'completed' });
        }
        emit(run, modelId, 'tool_call_completed', { tool: name, status: 'completed', resultSummary: summarizeResult(name, result), cost: toolResult.cost });
        modelMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
      }
    }
    if (!finalResult) throw new Error('Model did not provide the required structured final result');
    if (run.forceBet && !betPlaced) {
      throw new Error(betFailure || 'Mandatory bet was not successfully placed');
    }
    finalResult.betPlaced = betPlaced;
    finalResult.betDecision = betPlaced ? `Placed bet of ${betStakeCents} cents.` : 'No bet placed.';
    finalResult.selectedOption = betPlaced ? placedOption : null;
    finalResult.stake = betPlaced ? betStakeCents : 0;
    finalResult.status = 'completed';
    if (!betPlaced) {
      logger.ai('BET_NOT_PLACED', { runId: run.id, modelId, predictionId, forceBet: run.forceBet, reason: finalResult.reasoning });
      emit(run, modelId, 'bet_not_placed', { status: 'completed', reason: finalResult.reasoning });
    }
    logger.ai('FINAL_RESULT', { runId: run.id, modelId, predictionId, forceBet: run.forceBet, betPlaced, stopReason: finalResult.stopReason });
    emit(run, modelId, 'model_completed', {
      status: 'completed',
      finalResult,
      explanation: finalResult.reasoning,
      apiCost,
      betStakeCents,
      totalSpent: apiCost + betStakeCents / 100,
    });
    return true;
  } catch (error) {
    logger.error('AI_RUN_FAILED', { runId: run.id, modelId, predictionId, message: error.message, stack: error.stack });
    emit(run, modelId, 'model_error', { status: run.forceBet && !betPlaced ? 'mandatory_bet_failed' : 'failed', error: error.message, stopReason: betFailure || error.message });
    return false;
  }

  function summarizeResult(name, result) {
    if (name === 'search_news') return `${result.articles?.length || 0} articles`;
    if (name === 'get_price') return `ETH $${result.price}`;
    if (name === 'firecrawl_web_search') return result.ok ? `${result.resultCount} web results` : `Search error: ${result.error?.message || 'unknown error'}`;
    if (name === 'place_prediction_bet') return `bet ${result.option?.label || result.optionId} for ${result.amountCents} cents`;
    return 'prediction read';
  }
}

async function startRun(predictionId, userId, forceBet = false) {
  if (userId) {
    const bet = await db.performanceBet.findFirst({ where: { predictionId, userId, won: null } });
    if (!bet) throw new Error('Place a user bet before starting an AI run');
    const activeRun = await db.aiRun.findFirst({
      where: { predictionId, userId, status: 'RUNNING' },
      select: { id: true },
    });
    if (activeRun) throw new Error('An AI run is already in progress for this prediction');
  }
  const run = await createRun(predictionId, userId, forceBet);
  Promise.all(getAllJurorIds().map(modelId => runAgent(run, predictionId, modelId)))
    .then(results => {
      run.done = true;
      const status = results.every(Boolean) ? 'COMPLETED' : 'FAILED';
      db.aiRun.update({ where: { id: run.id }, data: { status, completedAt: new Date() } }).catch(() => {});
      emit(run, null, 'run_completed', { status: status.toLowerCase(), forceBet: run.forceBet });
    });
  return run;
}

function getRun(runId) {
  const run = runs.get(runId);
  if (!run) throw new Error('Betting run not found');
  return run;
}

module.exports = { getRun, startRun };
