const state = {
  predictions: [],
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setMessage(message = '', isError = false) {
  const element = document.getElementById('market-message');
  element.textContent = message;
  element.style.color = isError ? '#fb7185' : '#fbbf24';
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function formatExpiry(value) {
  return new Date(value).toLocaleString();
}

function renderPredictions() {
  const container = document.getElementById('prediction-list');
  if (!state.predictions.length) {
    container.innerHTML = '<p class="empty-state">No predictions are available yet.</p>';
    return;
  }

  container.innerHTML = state.predictions.map(prediction => `
    <article class="prediction-card">
      <h2>${escapeHtml(prediction.statement)}</h2>
      <p class="expiry">${prediction.expired ? 'Expired' : 'Expires'}: ${escapeHtml(formatExpiry(prediction.expiresAt))}</p>
      <form class="bet-form" data-prediction-id="${escapeHtml(prediction.id)}">
        <div class="options-list">
          ${prediction.options.map(option => `
            <div class="option-row">
              <input id="${escapeHtml(prediction.id)}-${escapeHtml(option.id)}" type="radio" name="option-${escapeHtml(prediction.id)}" value="${escapeHtml(option.id)}" ${prediction.expired ? 'disabled' : ''} required />
              <label for="${escapeHtml(prediction.id)}-${escapeHtml(option.id)}">${escapeHtml(option.label)}</label>
              <span class="option-count">${Number(option.betCount || 0)} bets</span>
            </div>
          `).join('')}
        </div>
        <input name="bettorId" placeholder="Bettor or juror ID" ${prediction.expired ? 'disabled' : ''} required />
        <button class="primary-button" type="submit" ${prediction.expired ? 'disabled' : ''}>${prediction.expired ? 'Closed' : 'Place bet'}</button>
      </form>
    </article>
  `).join('');
}

async function loadPredictions() {
  const data = await requestJson('/predictions');
  state.predictions = data.predictions;
  renderPredictions();
}

function renderHistory(bets) {
  const container = document.getElementById('bet-history');
  if (!bets.length) {
    container.innerHTML = '<p class="empty-state">No bets have been placed yet.</p>';
    return;
  }
  container.innerHTML = bets.map(bet => {
    const option = bet.prediction?.options?.find(candidate => candidate.id === bet.optionId);
    return `
      <div class="history-item">
        <strong>${escapeHtml(option?.label || bet.optionId)}</strong>
        <span> by ${escapeHtml(bet.bettorId)}</span>
        <div class="history-meta">${escapeHtml(bet.prediction?.statement || bet.predictionId)} · ${escapeHtml(formatExpiry(bet.placedAt))}</div>
      </div>
    `;
  }).join('');
}

async function loadHistory() {
  const data = await requestJson('/bets');
  renderHistory(data.bets);
}

async function handleBet(event) {
  event.preventDefault();
  const form = event.target.closest('.bet-form');
  if (!form) return;
  const option = form.querySelector('input[name^="option-"]:checked');
  const bettorId = form.elements.bettorId.value.trim();
  if (!option || !bettorId) return;

  const button = form.querySelector('button');
  button.disabled = true;
  setMessage('Requesting payment approval...');
  try {
    const data = await requestJson(`/predictions/${encodeURIComponent(form.dataset.predictionId)}/bets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionId: option.value, bettorId }),
    });
    setMessage(`Bet placed through ${data.bet.payment.mode} payment approval.`);
    await Promise.all([loadPredictions(), loadHistory()]);
  } catch (error) {
    setMessage(error.message, true);
    button.disabled = false;
  }
}

async function handleAdminCreate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const expiresAt = new Date(form.elements.expiresAt.value).toISOString();
  const options = form.elements.options.value.split('\n').map(option => option.trim()).filter(Boolean);
  try {
    await requestJson('/admin/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': form.elements.adminKey.value,
      },
      body: JSON.stringify({
        statement: form.elements.statement.value.trim(),
        options,
        expiresAt,
      }),
    });
    form.reset();
    setMessage('Prediction created.');
    await loadPredictions();
  } catch (error) {
    setMessage(error.message, true);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('refresh-btn').addEventListener('click', () => loadPredictions().catch(error => setMessage(error.message, true)));
  document.getElementById('history-refresh-btn').addEventListener('click', () => loadHistory().catch(error => setMessage(error.message, true)));
  document.getElementById('prediction-list').addEventListener('submit', handleBet);
  document.getElementById('admin-form').addEventListener('submit', handleAdminCreate);

  try {
    await Promise.all([loadPredictions(), loadHistory()]);
  } catch (error) {
    setMessage(error.message, true);
  }
});
