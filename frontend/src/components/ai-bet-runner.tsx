import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card } from './ui';
import { apiRoot, jsonBody, request } from '../lib/api';
import type { Prediction } from '../types';

type AgentId = 'skeptic' | 'pragmatist' | 'maverick';
type AgentEvent = { runId: string; modelId: string | null; type: string; timestamp: string; data: Record<string, unknown> };
type AgentState = { name: string; status: string; events: AgentEvent[]; completed?: AgentEvent; error?: string };
const agents: Array<{ id: AgentId; name: string }> = [
  { id: 'skeptic', name: 'The Skeptic' },
  { id: 'pragmatist', name: 'The Pragmatist' },
  { id: 'maverick', name: 'The Maverick' },
];

function initialStates(): Record<AgentId, AgentState> {
  return agents.reduce((result, agent) => {
    result[agent.id] = { name: agent.name, status: 'waiting', events: [] };
    return result;
  }, {} as Record<AgentId, AgentState>);
}

export function AiBetRunner({ prediction, onClose, onStake }: { prediction: Prediction; onClose: () => void; onStake?: () => void }) {
  const [states, setStates] = useState(initialStates);
  const [runId, setRunId] = useState<string>();
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState('');
  const [models, setModels] = useState<Array<{ id: AgentId; name: string; profit: number; roi: number }>>([]);
  const [selectedModel, setSelectedModel] = useState<AgentId>();
  const [stake, setStake] = useState('');
  const [forceBet, setForceBet] = useState(false);
  const active = Boolean(runId) && !finished;
  const orderedStates = useMemo(() => agents.map(agent => states[agent.id]), [states]);

  useEffect(() => {
    void request<{ models: Array<{ id: AgentId; name: string; profit: number; roi: number }> }>('/performance/models')
      .then(result => {
        setModels(result.models);
        setSelectedModel(result.models[0]?.id);
      })
      .catch(() => setError('Sign in before selecting an AI and staking a performance bet.'));
  }, []);

  useEffect(() => () => {
    // Closing the panel stops listening to the stream; the server run remains truthful and continues independently.
  }, []);

  async function start() {
    setError('');
    setStates(initialStates());
    setFinished(false);
    try {
      if (!selectedModel) throw new Error('Select an AI model first');
      const amountCents = Math.round(Number(stake) * 100);
      if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Enter a positive stake');
      await request('/performance/bets', jsonBody({ predictionId: prediction.id, modelId: selectedModel, amountCents }));
      onStake?.();
      const result = await request<{ runId: string }>('/performance/runs/start', jsonBody({ predictionId: prediction.id, forceBet }));
      setRunId(result.runId);
      const stream = new EventSource(`${apiRoot}/ai/bet/runs/${encodeURIComponent(result.runId)}/events`);
      stream.onmessage = event => {
        const next = JSON.parse(event.data) as AgentEvent;
        if (next.type === 'run_completed') { setFinished(true); stream.close(); return; }
        if (!next.modelId || !(next.modelId in states)) return;
        const id = next.modelId as AgentId;
        setStates(previous => {
          const current = previous[id];
          const nextState = { ...current, events: [...current.events, next], status: String(next.data.status ?? next.type) };
          if (next.type === 'model_completed') nextState.completed = next;
          if (next.type === 'model_error') nextState.error = String(next.data.error ?? 'Agent failed');
          return { ...previous, [id]: nextState };
        });
      };
      stream.onerror = () => { setError('The live event stream disconnected. Completed events remain visible.'); stream.close(); };
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not start the AI betting run'); }
  }

  return <Card className="mt-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Performance market</p><h2 className="mt-1 text-xl font-bold">Which AI will perform best?</h2><p className="mt-1 text-sm text-muted-foreground">{prediction.statement}</p></div><div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={start} disabled={active || !models.length}>{active ? 'Betting in progress…' : runId ? 'Run again' : 'Confirm stake & start'}</Button></div></div>{!runId && <><div className="mt-6 grid gap-3 md:grid-cols-3">{models.map(model => <button type="button" key={model.id} onClick={() => setSelectedModel(model.id)} className={`rounded-xl border p-4 text-left ${selectedModel === model.id ? 'border-primary bg-primary/10' : 'border-line bg-canvas'}`}><b>{model.name}</b><span className="mt-2 block text-xs text-muted-foreground">Historical profit ${(model.profit / 100).toFixed(2)} · ROI {(model.roi * 100).toFixed(1)}%</span></button>)}</div><div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center"><label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={forceBet} onChange={event => setForceBet(event.target.checked)} />Force all models to place a bet</label><p className="text-xs text-muted-foreground">When enabled, every model must successfully use the place-bet tool before completing. When disabled, each model may independently decline.</p></div><div className="mt-4 max-w-xs"><label className="grid gap-2 text-sm font-semibold">Your stake (USD)<input className="min-h-11 rounded-xl border border-line bg-canvas px-3.5 text-sm" type="number" min="0.01" step="0.01" value={stake} onChange={event => setStake(event.target.value)} /></label></div></>}{error && <p className="mt-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}<div className="mt-6 grid gap-4 overflow-x-auto md:grid-cols-3">{orderedStates.map((agent, index) => <AgentPanel key={agents[index].id} agent={agent} />)}</div></Card>;
}

function AgentPanel({ agent }: { agent: AgentState }) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  useEffect(() => {
    if (stickToBottom.current && timelineRef.current) timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [agent.events.length]);
  const completedData = agent.completed?.data;
  const final = completedData?.finalResult as { outcome?: string; betPlaced?: boolean; betDecision?: string; selectedOption?: string | null; stake?: number; reasoning?: string; stopReason?: string } | undefined;
  return <div className="min-h-72 rounded-2xl border border-line bg-canvas p-4"><div className="flex items-center justify-between gap-2"><h3 className="font-bold">{agent.name}</h3><Badge tone={agent.error ? 'danger' : agent.completed ? 'success' : 'warning'}>{agent.error ? (agent.status === 'mandatory_bet_failed' ? 'Mandatory bet failed' : 'Failed') : agent.completed ? 'Completed' : <span className="inline-flex items-center gap-1"><span className="animate-pulse">●</span>{humanStatus(agent.status)}</span>}</Badge></div><div ref={timelineRef} onScroll={event => { const element = event.currentTarget; stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24; }} className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1">{agent.events.length === 0 && <p className="text-sm text-muted-foreground">Waiting for the agent to start…</p>}{agent.events.map((event, index) => <EventRow event={event} key={`${event.timestamp}-${index}`} />)}</div>{agent.completed && <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs"><div><span className="block text-muted-foreground">API cost</span><b>{Number(completedData?.apiCost ?? 0).toFixed(3)} HBAR</b></div><div><span className="block text-muted-foreground">Stake</span><b>${(Number(completedData?.betStakeCents ?? 0) / 100).toFixed(2)}</b></div><div><span className="block text-muted-foreground">Total spent</span><b>{Number(completedData?.apiCost ?? 0).toFixed(3)} HBAR + ${(Number(completedData?.betStakeCents ?? 0) / 100).toFixed(2)}</b></div></div>}{final && <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm"><p className="font-bold">Final Result</p><p className="mt-2"><b>Outcome:</b> {final.outcome}</p><p className="mt-1"><b>Bet:</b> {final.betPlaced ? `Placed $${((final.stake ?? 0) / 100).toFixed(2)}${final.selectedOption ? ` on ${final.selectedOption}` : ''}` : 'NO BET'}</p><p className="mt-1"><b>Reason:</b> {final.reasoning}</p><p className="mt-1"><b>Stop reason:</b> {final.stopReason}</p></div>}{agent.error && <p className="mt-4 text-sm text-danger">{agent.error}</p>}</div>;
}

function EventRow({ event }: { event: AgentEvent }) {
  const tool = typeof event.data.tool === 'string' ? event.data.tool : undefined;
  const explanation = typeof event.data.explanation === 'string' ? event.data.explanation : undefined;
  const result = event.data.result as { option?: { label?: string }; amountCents?: number; payment?: { approved?: boolean } } | undefined;
  const args = event.data.args as Record<string, unknown> | undefined;
  const resultSummary = typeof event.data.resultSummary === 'string' ? event.data.resultSummary : undefined;
  return <div className={`border-l-2 pl-3 text-sm ${tool ? 'border-golden-pollen' : 'border-primary/30'}`}><p className="font-semibold">{event.type === 'tool_call_started' ? `Calling ${tool}` : humanStatus(event.type)}</p>{tool && <p className="mt-1 text-xs text-muted-foreground">Tool: {tool} · {String(event.data.status ?? 'running')}</p>}{args && <p className="mt-1 break-words text-xs text-muted-foreground">Input: {JSON.stringify(args)}</p>}{resultSummary && <p className="mt-1 text-xs text-muted-foreground">Result: {resultSummary}{typeof event.data.cost === 'number' ? ` · ${event.data.cost.toFixed(3)} HBAR` : ''}</p>}{event.type === 'tool_call_completed' && result && <p className="mt-1 text-xs text-muted-foreground">{result.option?.label ? `Selected: ${result.option.label} · ` : ''}{result.amountCents ? `Bet: $${(result.amountCents / 100).toFixed(2)} · ` : ''}{result.payment?.approved ? 'Payment approved' : ''}</p>}{explanation && <p className="mt-2 leading-6 text-muted-foreground">{explanation}</p>}</div>;
}

function humanStatus(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}
