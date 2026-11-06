const fs=require('fs'),vm=require('vm'),assert=require('assert');
const ts=require('typescript');
const path=require('path').join(__dirname,'../src/lib/fleet-scheduler.ts');
const code=ts.transpileModule(fs.readFileSync(path,'utf8')+'\nexports.runTest=runMaintenanceDueCheck;', {compilerOptions:{module:1,target:9}}).outputText;
async function check(counts,fail=false){
const keys=new Set(),wa=[],log=[],status=[];
async function query(sql,args=[]){if(sql.includes('INSERT INTO public.fleet_maintenance_alert_claims')){let k=args.join('|');if(keys.has(k))return [];keys.add(k);return [{run_date:'2026-11-06'}]};if(sql.includes('COUNT(*) FILTER'))return [{overdue:counts[0],upcoming:counts[1]}];if(sql.includes('FROM team_members'))return [{phone:'mock'}];if(sql.includes('UPDATE public.fleet_maintenance_alert_claims')){status.push(sql.match(/status='(\w+)'/)[1]);return []};if(sql.includes('INSERT INTO fleet_scheduler_runs')){log.push(args[2]);return []};throw Error('Unexpected query')}
const mock={'./logger':{logger:{info(){},error(){}}},'./supabase-db':{supabaseQuery:query,supabaseQueryStrict:query},'./fonnte':{sendFonnte:async()=>{wa.push(1);return {success:!fail}}}};
const ctx={exports:{},require:(x)=>mock[x],process:{env:{}},Date,Math,JSON};vm.runInNewContext(code,ctx);
await Promise.all([ctx.exports.runTest(),ctx.exports.runTest()]);await ctx.exports.runTest();
assert.equal(keys.size,1);assert.equal(wa.length,counts[0]+counts[1]>0?1:0);assert.equal(status.length,1);assert.equal(status[0],fail?'review_required':wa.length?'sent':'no_alert');return {wa:wa.length,status:status[0],runs:log.length};}
(async()=>{console.log('ZERO',await check([0,0]));console.log('DUE',await check([1,2]));console.log('FAIL_SEND',await check([1,2],true));console.log('MOCK 3/3 PASS');})().catch(e=>{console.error(e);process.exitCode=1});
