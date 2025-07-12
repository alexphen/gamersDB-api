const oracledb = require('oracledb');
require('dotenv').config();

async function testConnection() {
  try {
    // Optional: for reading CLOBs as strings
    oracledb.fetchAsString = [oracledb.CLOB];

    const connection = await oracledb.getConnection({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECT_STRING
    });

    console.log('✅ Connected to Oracle DB successfully!');

    const result = await connection.execute(`SELECT 'It works!' AS message FROM dual`);
    console.log('🎉 Query Result:', result.rows[0]);

    await connection.close();
    console.log('🔌 Connection closed.');
  } catch (err) {
    console.error('❌ Connection failed:', err);
  }
}

testConnection();
