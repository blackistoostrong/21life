import {readFileSync} from 'node:fs';
const base=readFileSync(new URL('./qa/analytics-dashboard-v2.sql',import.meta.url),'utf8');
const profile=readFileSync(new URL('./qa/profile-catalog-metrics-v2.sql',import.meta.url),'utf8');
if(!/ROLLBACK;\s*$/.test(base))throw new Error('Analytics QA must end with rollback');
process.stdout.write(base.replace(/ROLLBACK;\s*$/,()=>profile+'\nROLLBACK;\n'));
