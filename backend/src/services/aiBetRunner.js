const crypto = require('crypto');
const { OPENROUTER_API_KEY, OPENROUTER_API_URL, OPENROUTER_MODEL } = require('../config/env');
const { getJuror, getAllJurorIds } = require('../config/jurors');
const { readPrediction, placeAgentBet, tools } = require('./aiBettingTools');

const runs = new Map();

function emit(run, modelId, type, data = {}) {
  const event = { runId: run.id, modelId, type, timestamp: new Date().toISOString(), data };
  run.events.push(event);
  for (const listener of run.listeners) listener(event);
}

function createRun(predictionId) {
  const run = { id: `bet_run_${crypto.randomUUID()}`, predictionId, events: [], listeners: new Set(), done: false };
  runs.set(run.id, run);
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

async function runAgent(run, predictionId, modelId) {
  const juror = getJuror(modelId);
  const modelMessages = [
    { role: 'system', content: `${juror.systemPrompt}\n\nYou are executing an AI betting run. Use read_prediction first. Then independently select one available option and an amount in cents between 1 and 50000. You must call place_prediction_bet with modelId "${modelId}". Do not claim a bet was made unless the tool returns success. Your final response must briefly explain the decision without revealing private chain-of-thought.` },
    { role: 'user', content: `Analyze prediction ${predictionId}, read it with the tool, and place your independent bet.` },
  ];
  emit(run, modelId, 'model_started', { modelName: juror.name, status: 'starting' });
  let finalMessage;
  try {
    for (let iteration = 0; iteration < 4; iteration += 1) {
      emit(run, modelId, 'status', { status: iteration === 0 ? 'reading_market' : 'thinking' });
      const message = await callModel(modelMessages);
      finalMessage = message;
      modelMessages.push(message);
      if (!message?.tool_calls?.length) break;
      for (const toolCall of message.tool_calls) {
        const name = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments || '{}');
        emit(run, modelId, 'tool_call_started', { tool: name, args, status: 'running' });
        let result;
        if (name === 'read_prediction') {
          result = readPrediction(args.predictionId);
        } else if (name === 'place_prediction_bet') {
          emit(run, modelId, 'payment_started', { tool: name });
          result = await placeAgentBet(args);
          emit(run, modelId, 'payment_completed', { status: result.payment?.approved ? 'approved' : 'failed', transaction: result.transaction });
        } else {
          throw new Error(`Unsupported betting tool: ${name}`);
        }
        emit(run, modelId, 'tool_call_completed', { tool: name, status: 'completed', result });
        modelMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
      }
    }
    if (!finalMessage) throw new Error('Model returned no response');
    emit(run, modelId, 'model_completed', {
      status: 'completed',
      explanation: finalMessage.content || 'The model completed without an explanation.',
    });
  } catch (error) {
    emit(run, modelId, 'model_error', { status: 'failed', error: error.message });
  }
}

function startRun(predictionId) {
  const run = createRun(predictionId);
  Promise.allSettled(getAllJurorIds().map(modelId => runAgent(run, predictionId, modelId)))
    .then(() => { run.done = true; emit(run, null, 'run_completed', { status: 'completed' }); });
  return run;
}

function getRun(runId) {
  const run = runs.get(runId);
  if (!run) throw new Error('Betting run not found');
  return run;
}

module.exports = { getRun, startRun };
