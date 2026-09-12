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
