/**
 * Apify Actor entry point — starts the Express server
 */
const app = require('./server');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`json-schema-api (Apify Actor) running on port ${PORT}`);
});
