import test from 'node:test';
import assert from 'node:assert/strict';
import {assertStagingBackendReachable} from '../../scripts/staging-backend-preflight.mjs';

test('staging preflight stops before REST when the Auth gateway returns502',async()=>{
 const calls=[];
 await assert.rejects(assertStagingBackendReachable('https://fixture.invalid','fixture-key',async url=>{
  calls.push(url);return new Response('',{status:502});
 }),/Auth preflight failed \(HTTP 502\)/);
 assert.equal(calls.length,1);
});
test('staging preflight rejects an HTML proxy response even with status200',async()=>{
 await assert.rejects(assertStagingBackendReachable('https://fixture.invalid','fixture-key',async()=>new Response('<html>unavailable</html>')),
  /Auth preflight failed \(HTTP 200\)/);
});
test('staging preflight rejects a REST failure after healthy Auth',async()=>{
 await assert.rejects(assertStagingBackendReachable('https://fixture.invalid','fixture-key',async url=>
  url.endsWith('/health')?Response.json({version:'fixture'}):Response.json({message:'denied'},{status:401})),/REST preflight failed \(HTTP 401\)/);
});
test('staging preflight probes healthy Auth and zero REST rows with a bounded request',async()=>{
 const calls=[];
 await assertStagingBackendReachable('https://fixture.invalid/','fixture-key',async(url,options)=>{
  calls.push(url);assert.equal(options.headers.Authorization,'Bearer fixture-key');assert.ok(options.signal instanceof AbortSignal);
  return url.endsWith('/health')?Response.json({version:'fixture'}):Response.json([]);
 });
 assert.deepEqual(calls,['https://fixture.invalid/auth/v1/health','https://fixture.invalid/rest/v1/groups?select=id&limit=0']);
});
