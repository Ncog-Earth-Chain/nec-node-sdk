/* Separate bounded TLS selected-host TRANSPORT fixture. No SQL/custody/finality authority. */
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const assert = require('assert');
const { X509Certificate, createHash } = require('crypto');
const { verifyDdbPrivateCapabilityToken, ddbPrivateCapabilityAudience } = require('../../src/ddb-private-capability.ts');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cert = fs.readFileSync(config.certFile), key = fs.readFileSync(config.keyFile);
const pin = '0x' + createHash('sha256').update(new X509Certificate(cert).publicKey.export({ type:'spki',format:'der' })).digest('hex');
const sockets = new Set(), requests = [], rowSentinel = 'private-row-sentinel';
let trusted, secureConnections = 0, tcpConnections = 0, stopped = false, failed;
const server = https.createServer({ cert,key,minVersion:'TLSv1.3',maxVersion:'TLSv1.3',ecdhCurve:'X25519MLKEM768',
  ciphers:'TLS_AES_256_GCM_SHA384', ALPNProtocols:['http/1.1'] }, (req,res) => {
  const chunks = []; let count = 0;
  req.on('data', b => { count += b.length; if(count > 256*1024) req.destroy(new Error('bounded fixture request')); else chunks.push(b); });
  req.on('error', () => {});
  req.on('end', async () => {
    try {
      assert(trusted, 'fixture assignment must be installed before HTTP');
      assert.equal(req.method,'POST'); assert.equal(req.url,'/');
      assert.equal(req.socket.getProtocol(),'TLSv1.3'); assert.equal(req.socket.isSessionReused(),false);
      assert.equal(req.socket.getCipher().standardName,'TLS_AES_256_GCM_SHA384');
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(body.jsonrpc,'2.0');assert.equal(body.id,1);assert(Array.isArray(body.params));
      let result;
      if(body.method==='ddb_tokenSelect'||body.method==='ddb_tokenCallReadProcedure') {
        assert.equal(body.params.length,3);
        const token = body.params[0];
        assert.deepEqual(token.audience,ddbPrivateCapabilityAudience(trusted.chainId,trusted.route));
        const verified=await verifyDdbPrivateCapabilityToken(token,{chainId:trusted.chainId,lifetimeBound:600});
        assert(verified.valid, verified.reason);
        if(body.method==='ddb_tokenSelect') assert.deepEqual(body.params.slice(1),['vals',{filters:[{column:'secret',op:'=',value:'private-query-sentinel-TP01'}]}]);
        else assert.deepEqual(body.params.slice(1),['region_totals',['private-arg-sentinel-TP02']]);
        result=[{value:rowSentinel}];
      } else if(body.method==='ddb_previewPrivateBatch') {
        assert(JSON.stringify(body.params).includes('private-preview-sentinel-TP03'));
        result={preview:'private-preview-sentinel-TP03'};
      } else if(body.method==='ddb_putPayloadBatch') {
        assert(JSON.stringify(body.params).includes('private-sidecar-sentinel-TP04'));
        result={accepted:true};
      } else throw new Error('unexpected private method at selected transport host');
      requests.push({method:body.method,params:body.params,sessionReused:req.socket.isSessionReused()});
      res.writeHead(200,{'content-type':'application/json','connection':'close'});
      res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
    } catch(error) {
      failed=String(error.stack||error);res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:failed}));
    }
  });
});
server.on('connection',socket=>{tcpConnections++;sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
server.on('secureConnection',()=>secureConnections++);
server.on('tlsClientError',()=>{});
server.headersTimeout=5000;server.requestTimeout=10000;server.keepAliveTimeout=1;
function stop() {
  if(stopped)return;stopped=true;clearTimeout(deadline);
  server.close(()=>{
    const report={ok:!failed,pid:process.pid,secureConnections,tcpConnections,requests,rowSentinel,error:failed};
    fs.writeFileSync(path.join(config.outputDir,'host.json'),JSON.stringify(report,null,2));
    process.exitCode=failed?1:0;process.stdin.destroy();
  });
  for(const socket of sockets)socket.destroy();
}
const deadline=setTimeout(()=>{failed='selected-host helper hard deadline';stop();},90000);
process.on('SIGTERM',stop);process.on('SIGINT',stop);
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',line=>{
  try {
    if(Buffer.byteLength(line)>32768)throw new Error('bounded host control message');
    const message=JSON.parse(line);
    if(message.command==='configure') {assert(!trusted);trusted={chainId:message.chainId,route:message.route};console.log('NEC93_HOST_CONFIGURED');}
    else if(message.command==='stop')stop();
    else throw new Error('unknown owned host control');
  }catch(error){failed=String(error.stack||error);stop();}
}).on('close',()=>{if(!stopped)stop();});
server.listen(0,'127.0.0.1',()=>console.log('NEC93_HOST_READY '+JSON.stringify({pid:process.pid,url:'https://127.0.0.1:'+server.address().port,pin})));
