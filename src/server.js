require('dotenv').config();
const app        = require('./app');
const { testDb } = require('./config/db');
const PORT = process.env.PORT || 5000;

testDb().then(() => {
  app.listen(PORT, () => {
    console.log('\n🌙 Moonlight Accessories API');
    console.log(`   Server : http://localhost:${PORT}`);
    console.log(`   Env    : ${process.env.NODE_ENV}`);
    console.log(`   Docs   : http://localhost:${PORT}/api/docs\n`);
  });
}).catch(err => { console.error('❌ DB failed:', err.message); process.exit(1); });
