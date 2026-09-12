function escapeHtml(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

const form = document.getElementById('admin-form');
const message = document.getElementById('admin-message');
const headers = () => ({ 'Content-Type': 'application/json', 'x-admin-key': form.elements.adminKey.value });
const transferForm = document.getElementById('transfer-form');

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showError(error) {
  message.textContent = error.message;
  message.style.color = '#fb7185';
}

async function loadAdminData() {
  const [predictions, accounts, transactions] = await Promise.all([
    request('/predictions'),
    request('/admin/accounts', { headers: headers() }),
    request('/admin/transactions', { headers: headers() }),
  ]);
  document.getElementById('admin-listings').innerHTML = predictions.predictions.map(prediction => `
    <div class="history-item">
      <strong>${escapeHtml(prediction.statement)}</strong>
      <div class="history-meta">${escapeHtml(prediction.status)} · ${prediction.totalBets} bets · $${(prediction.totalPoolCents / 100).toFixed(2)}</div>
      ${prediction.status === 'active' ? `<button class="secondary-button end-listing" data-id="${escapeHtml(prediction.id)}">End listing</button>` : `<span>Winner: ${escapeHtml(prediction.winningOptionId || 'none')}</span>`}
    </div>
  `).join('') || '<p class="empty-state">No listings.</p>';
  document.getElementById('admin-accounts').innerHTML = accounts.accounts.map(account =>
    `<div class="history-item"><strong>${escapeHtml(account.accountId)}</strong> · ${escapeHtml(account.role)} · $${(account.balanceCents / 100).toFixed(2)}</div>`
  ).join('');
  document.getElementById('admin-transactions').innerHTML = transactions.transactions.map(transaction =>
    `<div class="history-item">${escapeHtml(transaction.type)}: ${escapeHtml(transaction.from)} → ${escapeHtml(transaction.to)} · $${(transaction.amountCents / 100).toFixed(2)}</div>`
  ).join('') || '<p class="empty-state">No transactions.</p>';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await request('/admin/predictions', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        statement: form.elements.statement.value,
        options: form.elements.options.value.split('\n').map(value => value.trim()).filter(Boolean),
        expiresAt: new Date(form.elements.expiresAt.value).toISOString(),
      }),
    });

    transferForm.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        await request('/admin/accounts/transfer', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            to: transferForm.elements.to.value.trim(),
            amountCents: Number(transferForm.elements.amountCents.value),
          }),
        });
        message.textContent = 'Funds transferred.';
        message.style.color = '#fbbf24';
        await loadAdminData();
      } catch (error) { showError(error); }
    });
    message.textContent = 'Listing created.';
    message.style.color = '#fbbf24';
    await loadAdminData();
  } catch (error) { showError(error); }
});

document.getElementById('admin-listings').addEventListener('click', async event => {
  if (!event.target.classList.contains('end-listing')) return;
  const prediction = await request(`/predictions/${encodeURIComponent(event.target.dataset.id)}`);
  const winningOptionId = window.prompt('Enter the winning option ID:\n\n' + prediction.prediction.options.map(option => `${option.id}: ${option.label}`).join('\n'));
  if (!winningOptionId) return;
  try {
    await request(`/admin/predictions/${encodeURIComponent(event.target.dataset.id)}/end`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ winningOptionId }),
    });
    await loadAdminData();
  } catch (error) { showError(error); }
});
