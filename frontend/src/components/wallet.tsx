import { FormEvent, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, PageHeader, StateMessage } from './ui';
import { jsonBody, request } from '../lib/api';

type WalletData = { balance: number; ledger: Array<{ id: string; type: string; amount: number; createdAt: string; reference?: string }> };

export function Wallet() {
  const [wallet, setWallet] = useState<WalletData>();
  const [amount, setAmount] = useState('');
  const [action, setAction] = useState<'deposit' | 'withdraw'>('deposit');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function load() {
    try {
      const result = await request<{ wallet: WalletData }>('/wallet');
      setWallet(result.wallet);
    } catch (err) { setError(err instanceof Error ? err.message : 'Wallet could not be loaded'); }
  }
  useEffect(() => { void load(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const amountCents = Math.round(Number(amount) * 100);
      await request(`/wallet/${action}`, jsonBody({ amountCents }));
      setAmount('');
      setMessage(`${action === 'deposit' ? 'Deposit' : 'Withdrawal'} approved.`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Wallet request failed'); }
  }
  async function transfer(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const amountCents = Math.round(Number(amount) * 100);
      await request('/wallet/transfer', jsonBody({ email: recipientEmail, amountCents }));
      setAmount('');
      setRecipientEmail('');
      setMessage('Transfer completed.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Transfer failed'); }
  }
  if (!wallet && !error) return <StateMessage type="loading" message="Loading wallet…" />;
  return <><PageHeader eyebrow="Your wallet" title="Balance and transactions" description="Deposits and withdrawals are virtual and automatically approved in this development environment." /><div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]"><Card><p className="text-sm text-muted-foreground">Available balance</p><p className="mt-2 text-4xl font-bold">${((wallet?.balance ?? 0) / 100).toFixed(2)}</p><div className="mt-6 flex gap-2"><Button variant={action === 'deposit' ? 'primary' : 'secondary'} onClick={() => setAction('deposit')}>Deposit</Button><Button variant={action === 'withdraw' ? 'primary' : 'secondary'} onClick={() => setAction('withdraw')}>Withdraw</Button></div><form onSubmit={submit} className="mt-5 grid gap-3"><Field label="Amount (USD)"><Input type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} required /></Field><Button>{action === 'deposit' ? 'Add funds' : 'Withdraw funds'}</Button></form><form onSubmit={transfer} className="mt-6 grid gap-3 border-t border-line pt-5"><h2 className="font-bold">Transfer to another user</h2><Field label="Recipient email"><Input type="email" value={recipientEmail} onChange={event => setRecipientEmail(event.target.value)} required /></Field><Field label="Transfer amount (USD)"><Input type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} required /></Field><Button variant="secondary">Transfer funds</Button></form>{message && <p className="mt-3 text-sm text-success">{message}</p>}{error && <p className="mt-3 text-sm text-danger">{error}</p>}</Card><Card><div className="flex items-center justify-between"><h2 className="text-xl font-bold">Transaction history</h2><Badge tone="muted">{wallet?.ledger.length ?? 0} records</Badge></div>{wallet?.ledger.length ? <div className="mt-4 divide-y divide-line">{wallet.ledger.map(transaction => <div key={transaction.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span><b>{transaction.type}</b><span className="ml-2 text-muted-foreground">{transaction.reference ?? ''}</span></span><span className={transaction.amount < 0 ? 'text-danger' : 'text-success'}>{transaction.amount < 0 ? '-' : '+'}${(Math.abs(transaction.amount) / 100).toFixed(2)}</span></div>)}</div> : <p className="mt-4 text-sm text-muted-foreground">No transactions yet.</p>}</Card></div></>;
}
