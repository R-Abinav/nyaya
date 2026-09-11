// Frontend logic for the investigation dashboard

const JURORS = [
  { id: 'skeptic', name: 'The Skeptic', icon: '🕵️' },
  { id: 'pragmatist', name: 'The Pragmatist', icon: '⚖️' },
  { id: 'maverick', name: 'The Maverick', icon: '🚀' },
];

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatAnalysis(value = '') {
  return escapeHtml(value)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function renderInvestigationColumns() {
  const progressContainer = document.getElementById('juror-progress');

  progressContainer.innerHTML = JURORS.map(juror => `
    <article class="juror-column" id="juror-${juror.id}">
      <header class="juror-column-header">
        <h3><span aria-hidden="true">${juror.icon}</span> ${juror.name}</h3>
        <span class="juror-status status-investigating">Investigating</span>
      </header>
      <section class="juror-live-section">
        <h4>Live Activity</h4>
        <p class="live-activity"><span class="spinner" aria-hidden="true"></span> Preparing a news search...</p>
      </section>
      <section class="juror-live-section">
        <h4>Tools Called</h4>
        <ul class="tool-list"><li>Waiting for agent activity</li></ul>
      </section>
      <section class="juror-live-section">
        <h4>Articles Read</h4>
        <ul class="article-list"><li>Waiting for news evidence</li></ul>
      </section>
      <section class="juror-live-section">
        <h4>Reasoning</h4>
        <div class="reasoning-log">The agent is evaluating whether a paid news query is worth the expected improvement to its ruling.</div>
      </section>
    </article>
  `).join('');
}

async function startInvestigation() {
  const questionInput = document.getElementById('case-question');
  const btn = document.getElementById('investigate-btn');
  const question = questionInput.value.trim();

  if (!question) {
    questionInput.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Allocating Jurors...';

  document.getElementById('investigation-results').style.display = 'none';
  const statusContainer = document.getElementById('investigation-status');
  statusContainer.style.display = 'block';
  document.getElementById('status-question').textContent = question;
  document.getElementById('status-deadline').textContent = 'Calculating...';
  renderInvestigationColumns();

  try {
    btn.textContent = 'Investigation in Progress...';

    const res = await fetch('/juror/investigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error || `Investigation request failed (${res.status})`);
    }

    document.getElementById('status-deadline').textContent = new Date(data.commitDeadline).toLocaleString();
    renderResults(data);
  } catch (error) {
    statusContainer.innerHTML = `<div class="request-error">Investigation failed: ${escapeHtml(error.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start New Investigation';
  }
}

function renderTools(toolCalls = []) {
  if (!toolCalls.length) {
    return '<li>No paid evidence tools were called.</li>';
  }

  return toolCalls.map(toolCall => `
    <li>
      <strong>${escapeHtml(toolCall.toolName)}</strong>
      <span>${escapeHtml(JSON.stringify(toolCall.args))}</span>
      <small>${Number(toolCall.cost || 0).toFixed(2)} HBAR · ${escapeHtml(toolCall.paymentStatus || 'payment status unavailable')}</small>
    </li>
  `).join('');
}

function renderArticles(toolCalls = []) {
  const articles = toolCalls.flatMap(toolCall => toolCall.result?.articles || []);

  if (!articles.length) {
    return '<li>No articles were returned.</li>';
  }

  return articles.map(article => `
    <li>
      <a href="${escapeHtml(article.link)}" target="_blank" rel="noreferrer">${escapeHtml(article.title || 'Untitled article')}</a>
      <p>${escapeHtml(article.description || 'No description available.')}</p>
      <small>${escapeHtml([article.pub_data, article.time].filter(Boolean).join(' ') || 'Publication time unavailable')}</small>
    </li>
  `).join('');
}

function renderResults(data) {
  const summary = data.summary;
  document.getElementById('total-jurors').textContent = summary.totalJurors;
  document.getElementById('verdict-split').textContent = `${summary.verdicts.yes} Y / ${summary.verdicts.no} N`;
  document.getElementById('avg-betting-fraction').textContent = `${(Number(summary.averageBettingFraction) * 100).toFixed(1)}%`;
  document.getElementById('total-spend').textContent = summary.totalSpent;
  document.getElementById('total-tools').textContent = summary.totalToolCalls;

  data.jurors.forEach(juror => {
    const column = document.getElementById(`juror-${juror.jurorId}`);
    if (!column) return;

    const verdictClass = juror.verdict === 'yes' ? 'verdict-yes' : 'verdict-no';
    const evidenceTrail = juror.evidenceTrail || {};
    const status = column.querySelector('.juror-status');

    status.textContent = 'Complete';
    status.className = 'juror-status status-complete';
    column.querySelector('.live-activity').innerHTML = `
      <span class="verdict-badge-large ${verdictClass}">${escapeHtml(juror.verdict.toUpperCase())}</span>
      <span>Bet fraction: <strong>${(juror.bettingFraction * 100).toFixed(1)}%</strong></span>
    `;
    column.querySelector('.tool-list').innerHTML = renderTools(evidenceTrail.toolCalls);
    column.querySelector('.article-list').innerHTML = renderArticles(evidenceTrail.toolCalls);
    column.querySelector('.reasoning-log').innerHTML = formatAnalysis(juror.analysis);

    column.insertAdjacentHTML('beforeend', `
      <section class="juror-result-summary">
        <div><strong>${juror.stake.toFixed(2)} HBAR</strong><span>Stake</span></div>
        <div><strong>${juror.totalSpent.toFixed(2)} HBAR</strong><span>Evidence spend</span></div>
        <div><strong>${juror.toolCallCount}</strong><span>Tool calls</span></div>
        <div class="commitment-value"><span>Commit hash</span><code>${escapeHtml(juror.commitment)}</code></div>
      </section>
    `);
  });

  document.getElementById('investigation-results').style.display = 'block';
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('case-question');
  if (input) {
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') startInvestigation();
    });
  }
});
