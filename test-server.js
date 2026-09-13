// Quick test to verify juror routes load correctly
const express = require('express');
const app = express();

app.use(express.json());

// Load juror routes directly
const jurorRoutes = require('./src/routes/juror');
app.use('/juror', jurorRoutes);

// Test route
app.get('/test', (req, res) => {
  res.json({ message: 'Test route works' });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Test server on port ${PORT}`);
  console.log('Testing juror routes...');
});
