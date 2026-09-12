const { DUMMY_X402_COST_HBAR } = require('../config/env');

/**
 * Temporary payment boundary for evidence calls.
 *
 * This deliberately does not create a transaction hash or claim on-chain
 * settlement. The contract-backed adapter can replace this function later.
 */
async function approveEvidencePayment({ caseId, jurorId, toolName }) {
  const amount = Number(DUMMY_X402_COST_HBAR);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('DUMMY_X402_COST_HBAR must be a positive number');
  }

  if (!caseId || !jurorId || !toolName) {
    throw new Error('caseId, jurorId, and toolName are required for payment approval');
  }

  return {
    approved: true,
    mode: 'dummy',
    amount,
    currency: 'HBAR',
    approvalId: `dummy-x402-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    approvedAt: new Date().toISOString(),
  };
}

module.exports = {
  approveEvidencePayment,
};
