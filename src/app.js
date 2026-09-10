const express = require('express');
const routes = require('./routes');

const app = express();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Routes
app.use('/', routes);

module.exports = app;
