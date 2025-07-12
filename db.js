const oracledb = require('oracledb');
require('dotenv').config();
oracledb.initOracleClient({ libDir: 'E:\\Oracle\\instantclient_23_8' });
// process.env.TNS_ADMIN = 'E:\\Oracle\\instantclient_23_8\\network\\admin';

const poolPromise = oracledb.createPool({
  user: process.env.ORACLE_USER,
  password: process.env.ORACLE_PASSWORD,
  connectString: process.env.ORACLE_CONNECT_STRING,
  poolMin: 2,
  poolMax: 10,
  poolIncrement: 1
});

module.exports = {
  getConnection: async () => {
    await poolPromise;
    return oracledb.getConnection();
  }
};
