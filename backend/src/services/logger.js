const fs = require('fs');
const path = require('path');

const logDirectory = path.resolve(__dirname, '../../logs');
fs.mkdirSync(logDirectory, { recursive: true });
for (const file of ['server.log', 'ai.log', 'payments.log', 'errors.log']) {
  fs.closeSync(fs.openSync(path.join(logDirectory, file), 'a'));
}

function write(file, event, context = {}) {
  const safeContext = JSON.stringify(context, (_, value) => {
    if (typeof value === 'string' && /(api[_-]?key|authorization|token|secret|password)/i.test(value)) return '[REDACTED]';
    // caseId is a real on-chain uint256, passed through as a BigInt (see jurorController.js) — JSON.stringify
    // throws on BigInt natively, which silently aborted every evidence tool call downstream of this logger.
    if (typeof value === 'bigint') return value.toString();
    return value;
  });
  fs.appendFileSync(path.join(logDirectory, file), `${new Date().toISOString()} ${event}${safeContext === '{}' ? '' : ` ${safeContext}`}\n`);
}

module.exports = {
  server: (event, context) => write('server.log', event, context),
  ai: (event, context) => write('ai.log', event, context),
  payment: (event, context) => write('payments.log', event, context),
  error: (event, context) => write('errors.log', event, context),
};
