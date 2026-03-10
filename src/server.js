require('dotenv').config();
const app        = require('./app');
const { testDb } = require('./config/db');
const PORT = process.env.PORT || 5000;

async function setupAndSeed() {
  try {
    await require('./config/setupDb').runSetup();
    await require('./config/seedDb').runSeed();
  } catch (e) {
    console.log('Setup/seed skipped:', e.message);
  }
}

app.listen(PORT, () => {
  console.log('\n🌙 Moonlight Accessories API');
  console.log(`   Server : http://localhost:${PORT}`);
  console.log(`   Env    : ${process.env.NODE_ENV}`);
  console.log(`   Docs   : http://localhost:${PORT}/api/docs\n`);

  const tryConnect = (attempts = 1) => {
    testDb()
      .then(() => {
        console.log('✅ Database ready');
        if (process.env.NODE_ENV === 'production') setupAndSeed();
      })
      .catch(err => {
        console.error(`❌ DB attempt ${attempts} failed: ${err.message}`);
        if (attempts < 10) setTimeout(() => tryConnect(attempts + 1), 3000);
        else { console.error('❌ DB unavailable after 10 attempts. Exiting.'); process.exit(1); }
      });
  };
  tryConnect();
});
