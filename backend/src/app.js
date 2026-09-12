const express = require('express');
const routes = require('./routes');
const logger = require('./services/logger');

const app = express();

// Middleware
app.use(express.json());
// Routes
app.use('/', routes);
app.use((error, req, res, next) => {
  logger.error('UNHANDLED_REQUEST_ERROR', { method: req.method, path: req.path, message: error.message, stack: error.stack });
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
