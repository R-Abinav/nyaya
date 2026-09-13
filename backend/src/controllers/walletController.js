const db = require('../db');

async function wallet(req, res) {
  const value = await db.wallet.findUnique({ where: { userId: req.user.id }, include: { ledger: { orderBy: { createdAt: 'desc' }, take: 100 } } });
  res.json({ wallet: value });
}
async function deposit(req, res) {
  const amount = Number(req.body.amountCents);
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'amountCents must be a positive integer' });
  const result = await db.$transaction(async tx => {
    const wallet = await tx.wallet.update({ where: { userId: req.user.id }, data: { balance: { increment: amount } } });
    const ledger = await tx.walletTransaction.create({ data: { walletId: wallet.id, type: 'DEPOSIT', amount, reference: req.body.reference || null } });
    return { wallet, ledger };
  });
  res.status(201).json(result);
}
async function withdraw(req, res) {
  const amount = Number(req.body.amountCents);
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'amountCents must be a positive integer' });
  try {
    const result = await db.$transaction(async tx => {
      const wallet = await tx.wallet.updateMany({ where: { userId: req.user.id, balance: { gte: amount } }, data: { balance: { decrement: amount } } });
      if (!wallet.count) throw new Error('Insufficient wallet balance');
      const current = await tx.wallet.findUnique({ where: { userId: req.user.id } });
      const ledger = await tx.walletTransaction.create({ data: { walletId: current.id, type: 'WITHDRAWAL', amount: -amount, reference: req.body.reference || null } });
      return { wallet: current, ledger };
    });
    res.status(201).json(result);
  } catch (error) { res.status(400).json({ error: error.message }); }
}
async function transactions(req, res) {
  const value = await db.wallet.findUnique({ where: { userId: req.user.id }, select: { ledger: { orderBy: { createdAt: 'desc' }, take: 100 } } });
  res.json({ transactions: value?.ledger || [] });
}
async function transfer(req, res) {
  const amount = Number(req.body.amountCents);
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email || !Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'A recipient email and positive amountCents are required' });
  }
  try {
    const result = await db.$transaction(async tx => {
      const recipient = await tx.user.findUnique({ where: { email }, select: { id: true, email: true } });
      if (!recipient) throw new Error('Recipient user was not found');
      if (recipient.id === req.user.id) throw new Error('You cannot transfer funds to yourself');
      const senderWallet = await tx.wallet.updateMany({
        where: { userId: req.user.id, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });
      if (!senderWallet.count) throw new Error('Insufficient wallet balance');
      const sender = await tx.wallet.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      const recipientWallet = await tx.wallet.update({
        where: { userId: recipient.id },
        data: { balance: { increment: amount } },
      });
      const reference = `transfer_${require('crypto').randomUUID()}`;
      await tx.walletTransaction.createMany({
        data: [
          { walletId: sender.id, type: 'TRANSFER', amount: -amount, reference, metadata: { direction: 'out', recipientEmail: recipient.email } },
          { walletId: recipientWallet.id, type: 'TRANSFER', amount, reference, metadata: { direction: 'in', senderId: req.user.id } },
        ],
      });
      return { reference, recipient: recipient.email, amountCents: amount };
    });
    res.status(201).json({ transfer: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}
module.exports = { wallet, deposit, withdraw, transactions, transfer };
