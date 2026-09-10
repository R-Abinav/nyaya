// Frontend logic for the investigation dashboard

const EXAMPLES = {
  rocket: {
    type: 'rocket-launch',
    question: 'Will SpaceX Starship flight 6 (launch ID: f4b6c4c0-42c4-4b9d-8c6f-4c9b9b9b9b9b) lift off successfully during its window?',
    id: `rc_${Date.now()}`
  },
  flight: {
    type: 'flight-delay',
    question: 'Will United flight UA123 (ICAO: a12345) arrive on time given current weather conditions?',
    id: `fl_${Date.now()}`
  },
  github: {
    type: 'github-stars',
    question: 'Will the facebook/react repository cross 250,000 stars by next month?',
    id: `gh_${Date.now()}`
  }
};

function loadExample(type) {
  const example = EXAMPLES[type];
  if (!example) return;

  document.getElementById('case-type').value = example.type;
  document.getElementById('case-question').value = example.question;
  document.getElementById('case-id').value = example.id;

  // Scroll to form
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function startInvestigation() {
  const questionInput = document.getElementById('case-question');
  const typeSelect = document.getElementById('case-type');
  const idInput = document.getElementById('case-id');
  const btn = document.getElementById('investigate-btn');

  const question = questionInput.value.trim();
  const caseType = typeSelect.value;
  const caseId = idInput.value.trim() || `case_${Date.now()}`;

  if (!question) {
    questionInput.focus();
    return;
  }

  // Update UI state
  btn.disabled = true;
  btn.textContent = 'Allocating Jurors...';

  // Hide results, show status
  document.getElementById('investigation-results').style.display = 'none';
  const statusContainer = document.getElementById('investigation-status');
  statusContainer.style.display = 'block';

  // Initialize status info
  document.getElementById('status-case-id').textContent = caseId;
  document.getElementById('status-question').textContent = question;
  document.getElementById('status-type').textContent = caseType;
  document.getElementById('status-deadline').textContent = 'Calculating...';

  // Set up mock progress animation for jurors
  const jurorNames = ['The Skeptic', 'The Pragmatist', 'The Maverick'];
  const progressContainer = document.getElementById('juror-progress');
  progressContainer.innerHTML = jurorNames.map(name => `
    <div class="juror-card">
      <div class="juror-card-header">
        <div class="juror-name">${name}</div>
        <div class="juror-status status-investigating">Investigating</div>
      </div>
      <div class="juror-metrics">
        <span><div class="spinner" style="width:12px;height:12px;border-width:2px;margin-right:5px"></div> Calling evidence tools...</span>
      </div>
    </div>
  `).join('');

  try {
    btn.textContent = 'Investigation in Progress...';

    const res = await fetch('/juror/investigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, caseType, caseId }),
    });

    const data = await res.json();

    if (data.error) {
      statusContainer.innerHTML = `<div style="color:#fb7185;padding:1rem;">Investigation failed: ${data.error}</div>`;
      return;
    }

    renderResults(data);

  } catch (err) {
    statusContainer.innerHTML = `<div style="color:#fb7185;padding:1rem;">Request failed: ${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start New Investigation';
  }
}

function renderResults(data) {
  // Hide status
  document.getElementById('investigation-status').style.display = 'none';

  // Show and populate results
  const resultsContainer = document.getElementById('investigation-results');
  resultsContainer.style.display = 'block';

  // Summary stats
  document.getElementById('total-jurors').textContent = data.summary.totalJurors;
  document.getElementById('verdict-split').textContent = `${data.summary.verdicts.yes} Y / ${data.summary.verdicts.no} N`;
  document.getElementById('avg-confidence').textContent = `${data.summary.averageConfidence}%`;
  document.getElementById('total-spend').textContent = data.summary.totalSpent;
  document.getElementById('total-tools').textContent = data.summary.totalToolCalls;

  // Juror details
  const detailsContainer = document.getElementById('juror-results');
  const icons = { skeptic: '🕵️', pragmatist: '⚖️', maverick: '🚀' };

  detailsContainer.innerHTML = data.jurors.map(juror => {
    const verdictClass = juror.verdict === 'yes' ? 'verdict-yes' : 'verdict-no';
    const icon = icons[juror.jurorId] || '👤';

    // Format analysis to convert markdown to basic HTML if needed
    const formattedAnalysis = juror.analysis
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '<br><br>');

    return `
      <div class="juror-result-card">
        <div class="juror-result-header">
          <div class="juror-result-title">
            <h3><span class="juror-icon">${icon}</span> ${juror.jurorName}</h3>
            <span class="verdict-badge-large ${verdictClass}">${juror.verdict.toUpperCase()}</span>
          </div>
          <div class="juror-stats">
            <div class="juror-stat">
              <div class="juror-stat-value">${juror.confidence}%</div>
              <div class="juror-stat-label">Confidence</div>
            </div>
            <div class="juror-stat">
              <div class="juror-stat-value">${juror.stake.toFixed(2)}</div>
              <div class="juror-stat-label">Stake (HBAR)</div>
            </div>
            <div class="juror-stat">
              <div class="juror-stat-value">${juror.totalSpent.toFixed(2)}</div>
              <div class="juror-stat-label">Evidence Spend</div>
            </div>
            <div class="juror-stat">
              <div class="juror-stat-value">${juror.toolCallCount}</div>
              <div class="juror-stat-label">Tool Calls</div>
            </div>
          </div>
        </div>
        <div class="juror-result-body">
          <div class="analysis-section">
            <h4>Analysis & Reasoning</h4>
            <div class="analysis-text">${formattedAnalysis}</div>
          </div>
          <div class="commitment-info">
            <div class="commitment-row">
              <span class="commitment-label">Commit Hash:</span>
              <span class="commitment-value">${juror.commitment}</span>
            </div>
            <div class="commitment-row">
              <span class="commitment-label">Private Salt:</span>
              <span class="commitment-value">${juror.salt}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Add enter key listener
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('case-question');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') startInvestigation();
    });
  }
});