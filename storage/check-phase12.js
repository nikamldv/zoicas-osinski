const fs = require('fs');
const mysql = require('mysql2/promise');
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) { const i=line.indexOf('='); if (i>0) process.env[line.slice(0,i)]=line.slice(i+1); }
(async()=>{const c=await mysql.createConnection({host:process.env.MYSQL_HOST,user:process.env.MYSQL_ADMIN_USER,password:process.env.MYSQL_ADMIN_PASSWORD,database:process.env.MYSQL_DATABASE}); const [rows]=await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('documents','messages','notifications','audit_logs') ORDER BY table_name"); console.log(JSON.stringify(rows)); await c.end();})().catch(e=>{console.error(e.code||e.message);process.exit(1)});
