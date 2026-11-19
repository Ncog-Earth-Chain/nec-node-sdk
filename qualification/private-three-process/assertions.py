"""Assertions written before helper/driver source. No network/process spawning here."""
import json
from pathlib import Path

SENTINELS = [b'private-query-sentinel-TP01', b'private-arg-sentinel-TP02', b'private-row-sentinel',
             b'private-preview-sentinel-TP03', b'private-sidecar-sentinel-TP04',
             b'negative-pin-query-sentinel-TP05', b'negative-target-query-sentinel-TP06']


def frames(raw, server):
    """Capture is AFTER outer TLS. Decode mask before confidentiality assertions."""
    if server:
        assert raw.startswith(b'HTTP/1.1 101 '), 'missing actual WSS upgrade response'
        raw = raw.split(b'\r\n\r\n', 1)[1]
    out = []
    while raw:
        if len(raw) < 2:
            break  # terminal partial close header cannot hold a sentinel
        first, second = raw[0], raw[1]
        assert first & 0x70 == 0, 'unexpected compression/extension bits'
        opcode, masked, count, at = first & 15, bool(second & 128), second & 127, 2
        assert masked is not server, 'wrong WebSocket mask direction'
        if count == 126:
            assert len(raw) >= 4; count, at = int.from_bytes(raw[2:4], 'big'), 4
        elif count == 127:
            assert len(raw) >= 10; count, at = int.from_bytes(raw[2:10], 'big'), 10
        assert count <= 65536, 'unbounded frame in transport witness'
        if masked:
            assert len(raw) >= at + 4; mask, at = raw[at:at+4], at + 4
        payload = raw[at:at+count]
        if masked:
            payload = bytes(n ^ mask[i % 4] for i, n in enumerate(payload))
        assert opcode in (0, 1, 2, 8, 9, 10), 'unexpected WebSocket opcode'
        out.append((opcode, payload))
        if len(raw) < at + count:
            break  # inspect decoded terminal partial payload too
        raw = raw[at+count:]
    return out


def assert_complete(root):
    root = Path(root)
    client = json.loads((root/'client.json').read_text())
    host = json.loads((root/'host.json').read_text())
    ingress = json.loads((root/'ingress.json').read_text())
    assert client['ok'] and host['ok'] and ingress['ok'], 'one role failed'
    pids = [client['pid'], host['pid'], ingress['pid']]
    assert len(set(pids)) == 3 and all(p > 0 for p in pids), 'roles did not run in distinct OS processes'
    assert client['cases'] == ['TP01','TP02','TP03','TP04','TP05','TP06']
    assert client['groups'] == ['X25519MLKEM768'] * 4, 'actual client group missing'
    assert client['oneUseRefusals'] == 4, 'one-use actual sockets were not checked'
    assert 'pin' in client['wrongPinError'].lower(), 'wrong pin refusal not causal'
    assert client['refusedTargetError'], 'nonmember outer route did not refuse'
    expected = ['ddb_tokenSelect','ddb_tokenCallReadProcedure','ddb_previewPrivateBatch','ddb_putPayloadBatch']
    requests = host['requests']
    assert [r['method'] for r in requests] == expected, 'unexpected HTTP method, resend, or negative reached HTTP'
    assert len(requests) == 4 and all(not r['sessionReused'] for r in requests)
    assert host['secureConnections'] == 5, 'nonmember target opened a host socket, or wrong pin skipped actual TLS'
    assert len(ingress['connections']) == 6, 'unexpected replacement/hidden outer channel'
    assert ingress['productionService'] and ingress['trustedFinalizedState'], 'ingress used a substitute authority/server'
    assert ingress['capturedBytes'] > 4096, 'ciphertext capture is absent'
    all_binary, routes = [], []
    for c in ingress['connections']:
        for direction, server in [('clientToIngress',False),('ingressToClient',True)]:
            decoded = frames((root/c[direction]).read_bytes(),server)
            for opcode,payload in decoded:
                for secret in SENTINELS:
                    assert secret not in payload, 'private sentinel visible after outer WSS decrypt/unmask'
                if opcode == 1:
                    routes.append(json.loads(payload))
                elif opcode in (0,2):
                    all_binary.append(payload)
            binary = b''.join(p for opcode,p in decoded if opcode in (0,2))
            for secret in SENTINELS:
                assert secret not in binary, 'private sentinel spans captured binary frames'
    assert len(routes) == 6 and sum(r['validatorId']=='0x2' for r in routes)==1
    assert all(set(r)=={'format','audience','chainId','contract','manager','runtimeHash','placementVersion','groupHash','validatorId','assignmentBlockHash'} for r in routes)
    joined = b''.join(all_binary)
    for secret in SENTINELS:
        assert secret not in joined
    # A real correctly encoded token, including its public key/signature, exists
    # at the host but must never occur in the outer decoded tunnel capture.
    token = requests[0]['params'][0]
    assert token['format']=='private-placement-read-cap-v1'
    for field in ['callerPubKey','signature']:
        assert token[field].encode() not in joined
    assert requests[0]['params'][1:] == ['vals',{'filters':[{'column':'secret','op':'=','value':SENTINELS[0].decode()}]}]
    assert requests[1]['params'][1:] == ['region_totals',[SENTINELS[1].decode()]]
    assert SENTINELS[3].decode() in json.dumps(requests[2]['params'])
    assert SENTINELS[4].decode() in json.dumps(requests[3]['params'])
    assert host['rowSentinel']==SENTINELS[2].decode()
    serialized = json.dumps(requests)
    assert SENTINELS[5].decode() not in serialized and SENTINELS[6].decode() not in serialized
    return {'format':'nec93-private-three-process-result-v1','ok':True,'pids':pids,'cases':7,'BASIC':0,
            'note':'Execution evidence only. Root must review exact tuple and set accepted BASIC separately.'}
