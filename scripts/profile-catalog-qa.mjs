import {readFileSync} from 'node:fs';
const base=readFileSync(new URL('./qa/analytics-dashboard-v2.sql',import.meta.url),'utf8');
const profile=readFileSync(new URL('./qa/profile-catalog-metrics-v2.sql',import.meta.url),'utf8');
const history=readFileSync(new URL('./qa/arena-history-v2.sql',import.meta.url),'utf8');
const arenaBundle=readFileSync(new URL('./qa/arena-analytics-bundle-v2.sql',import.meta.url),'utf8');
const adminScope=readFileSync(new URL('./qa/admin-row-security-scope.sql',import.meta.url),'utf8');
if(!/ROLLBACK;\s*$/.test(base))throw new Error('Analytics QA must end with rollback');
process.stdout.write(base.replace(/ROLLBACK;\s*$/,()=>profile+'\n'+history+'\n'+adminScope+'\n'+arenaBundle+'\nROLLBACK;\n'));
