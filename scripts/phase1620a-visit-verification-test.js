"use strict";

const {randomUUID, scryptSync} = require('node:crypto');
process.loadEnvFile(require('node:path').join(__dirname, '..', '.env.test'));
const e = process.env;
const base = 'http://127.0.0.1:3001';
if (e.ENV_FILE !== '.env.test' || e.PORT !== '3001' || e.MYSQL_HOST !== '127.0.0.1' || e.MYSQL_DATABASE !== 'zoicas_osinski_test') throw Error('Isolation guard');
const results = [];
function check(label, condition) {
  results.push(condition === null ? 'SKIPPED' : condition ? 'PASS' : 'FAIL');
  console.log(results.at(-1), label);
}
async function request(route, cookie, body) {
  const headers = {Origin:base};
  if (cookie) headers.Cookie = cookie;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + route, {headers, method:body ? 'POST' : 'GET', body:body && JSON.stringify(body)});
  return {status:response.status, body:await response.json(), cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function main() {
  const db = await require('mysql2/promise').createConnection({host:e.MYSQL_HOST,port:Number(e.MYSQL_PORT),database:e.MYSQL_DATABASE,user:e.MYSQL_ADMIN_USER,password:e.MYSQL_ADMIN_PASSWORD});
  const undo = [];
  async function insert(table, fields) {
    const [result] = await db.execute('INSERT INTO '+ table +' ('+ Object.keys(fields).join(',') +') VALUES ('+ Object.values(fields).map(()=>'?').join(',') +')',Object.values(fields));
    undo.unshift([table,result.insertId]);
    return result.insertId;
  }
  try {
    const [[{dbName}]] = await db.query('SELECT DATABASE() AS dbName');
    if (dbName !== e.MYSQL_DATABASE || (await request('/api/health')).body.database !== 'connected') throw Error('Test identity verification failed');
    const stamp = randomUUID().slice(0,10);
    const password = randomUUID()+'Aa!';
    const salt = randomUUID().replaceAll('-','');
    const password_hash = ['scrypt',salt,scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex')].join(String.fromCharCode(36));
    const email = 'phase1620-'+stamp+'@example.test';
    const manager = await insert('employees',{employee_number:'TEST-M-'+stamp,first_name:'Test',last_name:'Manager',email,phone:'0000',password_hash,role:'MANAGER',status:'ACTIVE',position:'Test'});
    const [[{id:customer}]] = await db.execute('SELECT id FROM customers WHERE customer_number=?',['TEST-KU-000001']);
    const order = await insert('orders',{order_number:'TEST-1620-'+stamp,customer_id:customer,service_type:'Reinigungsservice',title:'TEST Phase 16.20A',status:'GEPLANT',priority:'NORMAL'});
    const day = '2089-06-14';
    const ids = {};
    for (const [index,[tag,checkIn,report]] of Object.entries([
      ['On time','09:00:00','SHARED'],['Late','10:01:00','SUBMITTED'],['Missing check-in',null,null],['Next-day late','08:00:00',null]
    ])) {
      const hour = String(9+Number(index)).padStart(2,'0');
      const assignment = await insert('order_assignments',{order_id:order,employee_id:manager,assignment_date:day,start_time:hour+':00:00',end_time:String(10+Number(index))+':00:00',status:'GEPLANT'});
      ids[tag] = {assignment};
      if (checkIn) {
        const date = tag === 'Next-day late' ? '2089-06-15' : day;
        ids[tag].attendance = await insert('employee_attendance_sessions',{employee_id:manager,order_id:order,assignment_id:assignment,check_in_at:date+' '+checkIn,check_out_at:date+' 18:00:00',status:'CLOSED'});
      }
      if (report) ids[tag].report = await insert('service_reports',{report_number:'TEST-1620-'+index+'-'+stamp,order_id:order,assignment_id:assignment,customer_id:customer,employee_id:manager,service_date:day,summary:'Synthetic service verification',status:report,submitted_at:day+' 18:00:00',shared_with_customer_at:report==='SHARED'?day+' 18:00:00':null});
    }
    const admin = await request('/api/admin/login',null,{username:e.ADMIN_USERNAME,password:e.PHASE168_TEST_ADMIN_PASSWORD});
    const employee = await request('/api/employee/login',null,{email:'quality.employee.a@example.test',password:e.PHASE168_TEST_EMPLOYEE_PASSWORD});
    const client = await request('/api/customer/login',null,{email:'quality.customer@example.test',password:e.PHASE168_TEST_CUSTOMER_PASSWORD});
    const managerLogin = await request('/api/employee/login',null,{email,password});
    const route = '/api/admin/attendance?from='+day+'&to='+day+'&page_size=100';
    const overview = await request(route,admin.cookie);
    const row = (tag,data=overview)=>data.body.rows?.find(r=>r.assignment_id===ids[tag].assignment);
    check('Admin authorized',admin.status===200 && overview.status===200);
    check('Anonymous excluded',(await request(route)).status===401);
    check('Employee excluded',employee.status===200 && (await request(route,employee.cookie)).status===401);
    check('Customer excluded',client.status===200 && (await request(route,client.cookie)).status===401);
    check('MANAGER excluded',managerLogin.status===200 && (await request(route,managerLogin.cookie)).status===401);
    check('On-time check-in at scheduled boundary',row('On time')?.punctuality_status==='PÜNKTLICH');
    check('Late same-day check-in',row('Late')?.punctuality_status==='VERSPÄTET');
    // The required schema field cannot be null in a live assignment. The unit suite tests the fallback.
    check('Missing schedule (start_time is NOT NULL)',null);
    check('Missing check-in',row('Missing check-in')?.punctuality_status==='NICHT_ERFASST');
    check('Next-day check-in is late even with an earlier clock time (actual: '+row('Next-day late')?.punctuality_status+')',row('Next-day late')?.punctuality_status==='VERSPÄTET');
    check('Check-out without customer confirmation',!!row('On time')?.check_out_at && row('On time')?.customer_confirmed_at===null);
    check('Submitted report surfaced',row('Late')?.report_status==='SUBMITTED' && !!row('Late')?.submitted_at);
    check('Shared report displays absent confirmation',row('On time')?.report_status==='SHARED' && row('On time')?.customer_confirmed_at===null);
    const confirmed = await request('/api/customer/service-reports/'+ids['On time'].report+'/confirm',client.cookie,{});
    const refreshed = await request(route,admin.cookie);
    check('Customer submission reflected in admin overview',confirmed.status===200 && row('On time',refreshed)?.report_status==='CUSTOMER_CONFIRMED' && !!row('On time',refreshed)?.customer_confirmed_at);
    const foreign = await request('/api/employee/attendance/check-in',employee.cookie,{assignment_id:ids['On time'].assignment});
    check('Employee cannot check in to another person’s assignment',employee.status===200 && [403,404].includes(foreign.status));
  } finally {
    for (const [table,id] of undo) {
      try { await db.execute('DELETE FROM '+table+' WHERE id=?',[id]); } catch (error) { console.log('Fixture cleanup',table,error.code); }
    }
    await db.end();
  }
}
main().catch(error=>{console.log('Runner error',error.code||error.message);process.exitCode=1}).finally(()=>{
  console.log(Object.fromEntries(['PASS','FAIL','SKIPPED'].map(key=>[key,results.filter(r=>r===key).length])));
  if (results.includes('FAIL')) process.exitCode=1;
});
