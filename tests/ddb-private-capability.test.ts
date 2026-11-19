import { keccak_256 } from '@noble/hashes/sha3';
import { Ddb, type DdbSigner } from '../src/ddb';
import {
  canonicalDdbPrivateCapabilityBytes, canonicalDdbPrivateCapabilityHash, buildDdbPrivateCapabilityToken,
  parseDdbPrivateCapabilityToken, normalizeDdbPrivateCapabilityRole, verifyDdbPrivateCapabilityToken,
  type DdbPrivateCapabilityFields, type DdbPrivateCapabilityToken,
} from '../src/ddb-private-capability';
import { canonicalDdbCapabilityHash } from '../src/ddb-capability';
import vectors from './fixtures/private-capability-vectors.json';

const hex = (b: Uint8Array) => '0x' + Buffer.from(b).toString('hex');
const golden = vectors[0].token as DdbPrivateCapabilityFields;
function wire(): DdbPrivateCapabilityToken {
  return { ...golden, audience: { ...golden.audience }, callerPubKey: '0x'+'01'.repeat(2592), signature: '0x'+'02'.repeat(4627) };
}
function route(version = '0x7'): any {
  return { database:'c_'+golden.audience.contract.slice(2),contract:golden.audience.contract,enabled:true,private:true,
    block:'0x10',blockHash:'0x'+'33'.repeat(32),stateRoot:'0x'+'44'.repeat(32),epoch:'0x7',manager:golden.audience.manager,
    runtimeHash:golden.audience.runtimeHash,version,
    groupHash:hex(keccak_256(new Uint8Array([...new Uint8Array(31),1]))),
    members:[{validatorId:1,address:'0x'+'00'.repeat(19)+'01'}] };
}
function fixture(current = route()) {
  const direct=jest.fn(async (_m:string,_p:any[])=>[{secret:'result'}]);
  const ingress=jest.fn(async (m:string,_p:any[])=>{
    if(m==='eth_chainId')return '0x9af';
    if(m==='ddb_resolveDatabase')return {currentRoute:current};
    if(m==='ddb_hostEndpoints')return {hosts:[{validatorId:1,live:true,endpoints:[{scheme:'https',url:'https://host.example',tlsKeyHash:'0x'+'55'.repeat(32)}]}]};
    throw new Error('private request reached ingress '+m);
  });
  const verifyAssignment=jest.fn(async()=>true);
  const connect=jest.fn(async (request:any)=>({binding:{route:request.route,validatorId:request.member.validatorId,address:request.member.address,
    url:request.endpoints[0].url,tlsKeyHash:request.endpoints[0].tlsKeyHash},endpointAuthenticated:true as const,confidentiality:'post-quantum' as const,send:direct}));
  const token=wire();token.audience.groupHash=current.groupHash;
  const policy={verifyAssignment,connect};
  return {token,direct,ingress,connect,verifyAssignment,policy,ddb:new Ddb({send:ingress} as any,{privateRouting:{policy}})};
}

describe('private placement read capability',()=>{
  test('independent Python preimages and Keccak vectors match Go/SDK',()=>{
    for(const v of vectors){
      expect(hex(canonicalDdbPrivateCapabilityBytes(v.token as DdbPrivateCapabilityFields))).toBe(v.preimage);
      expect(hex(canonicalDdbPrivateCapabilityHash(v.token as DdbPrivateCapabilityFields))).toBe(v.hash);
    }
    expect(normalizeDdbPrivateCapabilityRole('\u0085\u039f\u03a3\u0130\u00a0')).toBe('\u03bf\u03c3i');
    expect(normalizeDdbPrivateCapabilityRole('\ufeffReader')).toBe('\ufeffreader');
    for(const role of ['Reader',' reader','reader\u0085','\ud800','', '\u00e9'.repeat(33)]){
      expect(()=>canonicalDdbPrivateCapabilityHash({...golden,role})).toThrow();
    }
  });
  test('closed private wire rejects duplicates, unknown, missing, overflow and noncanonical values',()=>{
    const token=wire(),raw=JSON.stringify(token);
    expect(parseDdbPrivateCapabilityToken(raw)).toEqual(token);
    const bad=[raw.replace(/}$/,',"role":"writer"}'),raw.replace(/}$/,',"unknown":"x"}'),
      raw.replace('"chainId":"0x9af"','"chainId":"0x9af","chainId":"0x9af"'),
      raw.replace('"chainId":"0x9af"','"chainId":"0x09af"'),
      raw.replace('"chainId":"0x9af"','"chainId":"0x'+'f'.repeat(65)+'"'),
      raw.replace('"placementVersion":"0x7"','"placementVersion":"0x10000000000000000"'),
      raw.replace('"role":"reader"','"role":"\\ud800"'),
      raw.replace('"nonce":"0x2a",',''),raw.replace('private-placement-read-cap-v1','private-placement-read-cap-v2')];
    for(const value of bad)expect(()=>parseDdbPrivateCapabilityToken(value)).toThrow();
    expect(()=>parseDdbPrivateCapabilityToken({...token,signature:'0x01'})).toThrow();
    expect(()=>parseDdbPrivateCapabilityToken({...token,audience:{...token.audience,groupVersion:'0x7'}})).toThrow();
  });
  test('every signed field and the separate purpose are bound',()=>{
    const original=hex(canonicalDdbPrivateCapabilityHash(golden));
    for(const [key,value] of Object.entries({chainId:'0x1',contract:'0x'+'33'.repeat(20),manager:'0x'+'44'.repeat(20),
      runtimeHash:'0x'+'55'.repeat(32),placementVersion:'0x8',groupHash:'0x'+'66'.repeat(32)})){
      expect(hex(canonicalDdbPrivateCapabilityHash({...golden,audience:{...golden.audience,[key]:value}}))).not.toBe(original);
    }
    for(const [key,value] of Object.entries({role:'writer',caller:'0x'+'77'.repeat(20),issuedAt:'0x1',expiry:'0x2',nonce:'0x3'})){
      expect(hex(canonicalDdbPrivateCapabilityHash({...golden,[key]:value}))).not.toBe(original);
    }
    expect(hex(canonicalDdbCapabilityHash({...golden,...golden.audience,groupVersion:'0x7'}))).not.toBe(original);
  });
  test('builder signs the approved raw hash and validates lifetime before signing',async()=>{
    const signed:Uint8Array[]=[];
    const signer:DdbSigner={getAddress:()=>golden.caller,getPublicKey:()=>new Uint8Array(2592).fill(1),
      signDdbHash:(hash)=>{signed.push(hash);return new Uint8Array(4627).fill(2);}};
    const token=await buildDdbPrivateCapabilityToken(signer,{audience:golden.audience,role:' Reader ',issuedAt:1800000000,ttlSeconds:600,nonce:42});
    expect(hex(signed[0])).toBe(vectors[0].hash);
    expect(token.role).toBe('reader');
    await expect(buildDdbPrivateCapabilityToken(signer,{audience:golden.audience,role:'reader',ttlSeconds:3601})).rejects.toThrow();
    expect(signed).toHaveLength(1);
  });
  test('actual ML-DSA-87 verifies private purpose and refuses public-purpose substitution',async()=>{
    // @ts-ignore bundled module has no declarations
    const module=await import('../src/noble-post-quantum.js');
    const ml=(module.default||module).ml_dsa87,kp=ml.keygen(new Uint8Array(32).fill(42));
    const caller=hex(keccak_256(kp.publicKey).slice(12));
    const signer:DdbSigner={getAddress:()=>caller,getPublicKey:()=>kp.publicKey,signDdbHash:(hash)=>ml.sign(kp.secretKey,hash)};
    const token=await buildDdbPrivateCapabilityToken(signer,{audience:golden.audience,role:'reader',issuedAt:1800000000,ttlSeconds:600,nonce:42});
    expect(await verifyDdbPrivateCapabilityToken(token,{chainId:2479,now:1800000010,lifetimeBound:600})).toEqual({valid:true});
    const publicHash=canonicalDdbCapabilityHash({...golden,...golden.audience,caller,groupVersion:'0x7'});
    expect((await verifyDdbPrivateCapabilityToken({...token,signature:hex(ml.sign(kp.secretKey,publicHash))},
      {chainId:2479,now:1800000010,lifetimeBound:600})).valid).toBe(false);
  });
  test('both token reads use only actual authenticated selected-host transport',async()=>{
    const f=fixture();
    expect(await f.ddb.tokenSelect(f.token,'vals',{filters:[{column:'secret',op:'=',value:'query-sentinel'}]})).toEqual([{secret:'result'}]);
    await f.ddb.tokenCallReadProcedure(f.token,'region_totals',['arg-sentinel']);
    expect(f.direct.mock.calls.map(([method])=>method)).toEqual(['ddb_tokenSelect','ddb_tokenCallReadProcedure']);
    expect(JSON.stringify(f.ingress.mock.calls)).not.toContain('query-sentinel');
    expect(JSON.stringify(f.ingress.mock.calls)).not.toContain('arg-sentinel');
    expect(JSON.stringify(f.ingress.mock.calls)).not.toContain('callerPubKey');
    expect(JSON.stringify(f.connect.mock.calls)).not.toContain('callerPubKey');
  });
  test('stale audience, untrusted route and wrong channel refuse with no private ingress fallback',async()=>{
    const stale=fixture();stale.token.audience.placementVersion='0x6';
    await expect(stale.ddb.tokenSelect(stale.token,'vals')).rejects.toThrow(/audience/);
    expect(stale.connect).not.toHaveBeenCalled();expect(stale.direct).not.toHaveBeenCalled();
    const untrusted=fixture();untrusted.verifyAssignment.mockResolvedValue(false);
    await expect(untrusted.ddb.tokenSelect(untrusted.token,'vals')).rejects.toThrow(/trusted/);
    expect(untrusted.connect).not.toHaveBeenCalled();
    const wrong=fixture();wrong.connect.mockImplementation(async(request:any)=>({binding:{route:request.route,validatorId:1,address:request.member.address,
      url:'https://ingress.example',tlsKeyHash:request.endpoints[0].tlsKeyHash},endpointAuthenticated:true,confidentiality:'post-quantum',send:wrong.direct}));
    await expect(wrong.ddb.tokenSelect(wrong.token,'vals')).rejects.toThrow(/bound/);
    expect(wrong.direct).not.toHaveBeenCalled();
    await expect(new Ddb({send:wrong.ingress} as any).tokenSelect(wrong.token,'vals')).rejects.toThrow(/private routing/);
  });
  test('network failure or stale-route response does not resend or replace the token',async()=>{
    const f=fixture();f.direct.mockRejectedValue({code:-32063,data:{reason:'stale_route',preService:true}});
    await expect(f.ddb.tokenSelect(f.token,'vals')).rejects.toBeDefined();
    expect(f.direct).toHaveBeenCalledTimes(1);expect(f.connect).toHaveBeenCalledTimes(1);
  });
});
