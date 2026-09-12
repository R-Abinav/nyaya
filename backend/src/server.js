const app = require('./app');
const { PORT } = require('./config/env');

app.listen(PORT, () => {
  console.log(`nyaya server running on port ${PORT}`);
});
