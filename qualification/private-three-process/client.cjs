/* Actual SDK client in its own OS process; no fake success transports. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { keccak_256 } = require('@noble/hashes/sha3');
const { Ddb } = require('../../src/ddb.ts');
const { parseDdbCurrentReadRoute } = require('../../src/ddb-private-read.ts');
const { connectDdbNodePrivateRead } = require('../../src/ddb-private-read-node.ts');
const { createDdbNodePrivateTunnelDialer,projectDdbPrivateTunnelRoute } = require('../../src/ddb-private-tunnel-node.ts');
const { buildDdbPrivateCapabilityToken,ddbPrivateCapabilityAudience } = require('../../src/ddb-private-capability.ts');
const pqModule = require('../../src/noble-post-quantum.js'), ml=(pqModule.default||pqModule).ml_dsa87;
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const ca=fs.readFileSync(config.certFile), route=parseDdbCurrentReadRoute(config.route.contract,config.route);
const member=route.members[0], groups=[], cases=[];
let oneUseRefusals=0,wrongPinError='',refusedTargetError='';
const hex=b=>'0x'+Buffer.from(b).toString('hex');
const channels=[];
function connection(pin=config.selectedPin){return {route,member,endpoints:[{scheme:'https',url:config.selectedURL,tlsKeyHash:pin}]};}
async function open(request,fault) {
  const pin=fault==='wrongPin'?'0x'+'aa'.repeat(32):config.selectedPin;
  const trusted={route,validatorId:member.validatorId,address:member.address,url:config.selectedURL,tlsKeyHash:pin};
  const options={ca,timeoutMs:5000};
  if(fault==='refusedTarget') {
    options.socketDialer=createDdbNodePrivateTunnelDialer({ca,timeoutMs:5000,ingressURL:config.ingressURL,
      route:{...projectDdbPrivateTunnelRoute(config.chainId,route,member.validatorId),validatorId:'0x2'}});
  } else options.tunnel={ca,timeoutMs:5000,chainId:config.chainId,ingressURL:config.ingressURL};
  const actual=await connectDdbNodePrivateRead(request,trusted,options);
  assert.equal(actual.negotiatedGroup,'X25519MLKEM768');
  groups.push(actual.negotiatedGroup);channels.push(actual);
  return actual;
}
function client(fault) {
  const pin=fault==='wrongPin'?'0x'+'aa'.repeat(32):config.selectedPin;
  const provider={send:async(method,params)=>{
    if(method==='eth_chainId')return config.chainId;
    if(method==='ddb_resolveDatabase'){assert.deepEqual(params,[route.contract,{currentRoute:true}]);return {currentRoute:route};}
    if(method==='ddb_hostEndpoints')return {hosts:[{validatorId:member.validatorId,live:true,endpoints:connection(pin).endpoints}]};
    throw new Error('private request escaped actual inner channel '+method);
  }};
  // This locally owned fixture record is the test's trusted input. Equality is
  // not a production chain-proof implementation or authorization substitute.
  return new Ddb(provider,{privateRouting:{policy:{verifyAssignment:async candidate=>JSON.stringify(candidate)===JSON.stringify(route),
    connect:request=>open(request,fault)}}});
}
async function consumed(channel) {
  await assert.rejects(()=>channel.send('ddb_tokenSelect',[]),/already consumed/);oneUseRefusals++;
}
async function main(){
  assert.equal(route.members.length,1);assert.equal(member.validatorId,1);
  const kp=ml.keygen(new Uint8Array(32).fill(42));
  const signer={getAddress:()=>hex(keccak_256(kp.publicKey).slice(12)),getPublicKey:()=>kp.publicKey,signDdbHash:hash=>ml.sign(kp.secretKey,hash)};
  const token=await buildDdbPrivateCapabilityToken(signer,{audience:ddbPrivateCapabilityAudience(config.chainId,route),role:'reader',ttlSeconds:60,nonce:1});
  assert.deepEqual(await client().tokenSelect(token,'vals',{filters:[{column:'secret',op:'=',value:'private-query-sentinel-TP01'}]}),[{value:'private-row-sentinel'}]);
  await consumed(channels[0]);cases.push('TP01');
  assert.deepEqual(await client().tokenCallReadProcedure(token,'region_totals',['private-arg-sentinel-TP02']),[{value:'private-row-sentinel'}]);
  await consumed(channels[1]);cases.push('TP02');
  let channel=await open(connection());
  assert.deepEqual(await channel.send('ddb_previewPrivateBatch',[{database:route.database,operations:[{data:'private-preview-sentinel-TP03'}]}]),{preview:'private-preview-sentinel-TP03'});
  await consumed(channel);cases.push('TP03');
  channel=await open(connection());
  assert.deepEqual(await channel.send('ddb_putPayloadBatch',[{database:route.database,sidecars:[{salt:'0x'+'11'.repeat(32),payload:'private-sidecar-sentinel-TP04'}]}]),{accepted:true});
  await consumed(channel);cases.push('TP04');
  await assert.rejects(()=>client('wrongPin').tokenSelect(token,'vals',{filters:[{column:'secret',op:'=',value:'negative-pin-query-sentinel-TP05'}]}),error=>{
    wrongPinError=String(error.message||error);return /pin/.test(wrongPinError);
  });cases.push('TP05');
  await assert.rejects(()=>client('refusedTarget').tokenSelect(token,'vals',{filters:[{column:'secret',op:'=',value:'negative-target-query-sentinel-TP06'}]}),error=>{
    refusedTargetError=String(error.message||error);return true;
  });cases.push('TP06');
}
const deadline=setTimeout(()=>{throw new Error('actual SDK client hard deadline');},60000);
main().then(()=>{
  clearTimeout(deadline);
  fs.writeFileSync(path.join(config.outputDir,'client.json'),JSON.stringify({ok:true,pid:process.pid,cases,groups,oneUseRefusals,wrongPinError,refusedTargetError},null,2));
  console.log('NEC93_CLIENT_DONE '+JSON.stringify({pid:process.pid,cases}));
}).catch(error=>{
  clearTimeout(deadline);for(const channel of channels)channel.close();
  fs.writeFileSync(path.join(config.outputDir,'client.json'),JSON.stringify({ok:false,pid:process.pid,cases,groups,error:String(error.stack||error)},null,2));
  console.error(String(error.stack||error));process.exitCode=1;
});
