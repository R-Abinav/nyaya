const app = require('./app');
const { PORT } = require('./config/env');
const logger = require('./services/logger');

logger.server('SERVER_STARTED', { port: PORT, pid: process.pid });
app.listen(PORT, () => {
  console.log(`nyaya server running on port ${PORT}`);
});

process.on('SIGTERM', () => logger.server('SERVER_SHUTDOWN', { signal: 'SIGTERM' }));
process.on('SIGINT', () => logger.server('SERVER_SHUTDOWN', { signal: 'SIGINT' }));
