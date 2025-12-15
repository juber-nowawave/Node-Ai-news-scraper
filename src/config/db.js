const sql = require('mssql');
require('dotenv').config();

const config = {
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    server: process.env.MSSQL_HOST,
    database: process.env.MSSQL_DATABASE,
    port: 1433,
    options: {
        encrypt: true, // Use this if you're on Windows Azure
        trustServerCertificate: true // Change to true for local dev / self-signed certs
    },
    connectionTimeout: 30000 
};

async function connectDB() {
    try {
        let pool = await sql.connect(config);
        console.log("✅ Connected to MSSQL");
        return pool;
    } catch (err) {
        console.error("❌ Database Connection Failed! Bad Config: ", err);
        throw err;
    }
}

module.exports = {
    connectDB,
    sql
};
