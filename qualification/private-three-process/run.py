#!/usr/bin/env python3
"""Owned, bounded supervisor. Run only in the root-authorized Azure test scope."""
import argparse
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import time

from assertions import assert_complete

HERE = Path(__file__).resolve().parent
SDK = HERE.parents[1]


class Role:
    def __init__(self, name, command, env, output):
        self.name, self.events = name, queue.Queue(maxsize=1024)
        self.log = (output/(name+'.log')).open('w', encoding='utf-8')
        # Roles themselves spawn no helpers, daemons, shells or replacement clients.
        flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        self.proc = subprocess.Popen(command, cwd=SDK, env=env, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     text=True, encoding='utf-8', errors='replace', bufsize=1,
                                     creationflags=flags)
        self.reader = threading.Thread(target=self._read, name='capture-'+name, daemon=False)
        self.reader.start()

    def _read(self):
        budget = 0
        try:
            while True:
                line = self.proc.stdout.readline(131073)
                if not line:
                    break
                budget += len(line.encode('utf-8'))
                if budget > 1024*1024 or len(line) > 131072:
                    self.events.put_nowait(('error', 'bounded role log overflow'))
                    return
                self.log.write(line); self.log.flush()
                self.events.put_nowait(('line', line.rstrip('\r\n')))
        except Exception as error:
            try:
                self.events.put_nowait(('error', str(error)))
            except queue.Full:
                pass
        finally:
            self.proc.stdout.close()

    def marker(self, prefix, seconds):
        deadline = time.monotonic()+seconds
        while time.monotonic() < deadline:
            try:
                kind, line = self.events.get(timeout=min(0.2, max(0.001, deadline-time.monotonic())))
            except queue.Empty:
                if self.proc.poll() is not None:
                    raise RuntimeError(self.name+' exited before '+prefix)
                continue
            if kind == 'error':
                raise RuntimeError(self.name+': '+line)
            if line.startswith(prefix):
                return line[len(prefix):]
        raise TimeoutError(self.name+' did not emit '+prefix)

    def send(self, value):
        raw = value if isinstance(value, str) else json.dumps(value, separators=(',', ':'))+'\n'
        self.proc.stdin.write(raw); self.proc.stdin.flush()

    def wait(self, seconds):
        result = self.proc.wait(timeout=seconds)
        self.reader.join(timeout=2)
        if self.reader.is_alive():
            raise RuntimeError(self.name+' log reader did not join')
        if result:
            raise RuntimeError(self.name+' exited '+str(result)+'; see '+self.name+'.log')

    def cleanup(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.proc.kill(); self.proc.wait(timeout=2)
        if self.proc.stdin and not self.proc.stdin.closed:
            self.proc.stdin.close()
        self.reader.join(timeout=2)
        self.log.close()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2)+'\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--go-test-binary', required=True, type=Path)
    parser.add_argument('--node', default='node')
    parser.add_argument('--ts-node-register', type=Path,
                        default=SDK/'node_modules/ts-node/register/transpile-only.js')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    binary, output, register = args.go_test_binary.resolve(), args.output.resolve(), args.ts_node_register.resolve()
    node = shutil.which(args.node) or args.node
    if not binary.is_file() or not register.is_file():
        raise RuntimeError('prebuilt gossip test binary and existing ts-node register are required; no build/install fallback')
    if output.exists() and any(output.iterdir()):
        raise RuntimeError('output must be a fresh empty owned directory; existing evidence is never overwritten/deleted')
    output.mkdir(parents=True, exist_ok=True)
    cert = SDK/'tests/fixtures/pq-node-cert.pem'
    key = SDK/'tests/fixtures/pq-node-key.pem'
    env = dict(os.environ)
    env['TS_NODE_PROJECT'] = str(SDK/'tsconfig.json')
    env['TS_NODE_COMPILER_OPTIONS'] = json.dumps({'module':'CommonJS','moduleResolution':'node'})
    env['TS_NODE_TRANSPILE_ONLY'] = 'true'
    roles = []
    try:
        host_config = output/'host-config.json'
        write_json(host_config, {'certFile':str(cert),'keyFile':str(key),'outputDir':str(output)})
        host = Role('host',[node,'-r',str(register),str(HERE/'selected-host.cjs'),str(host_config)],env,output)
        roles.append(host)
        endpoint = json.loads(host.marker('NEC93_HOST_READY ',30))
        assert endpoint['pid'] == host.proc.pid
        ingress_config = output/'ingress-config.json'
        write_json(ingress_config, {'certFile':str(cert),'keyFile':str(key),'selectedURL':endpoint['url'],
                                  'selectedPin':endpoint['pin'],'outputDir':str(output)})
        ingress_env = dict(env, NEC93_PRIVATE_THREE_PROCESS_CONFIG=str(ingress_config))
        ingress = Role('ingress',[str(binary),'-test.run=^TestPrivateTunnelThreeProcessIngressHelper$',
                                  '-test.count=1','-test.v','-test.timeout=110s'],ingress_env,output)
        roles.append(ingress)
        ready = json.loads(ingress.marker('NEC93_PROCESS_READY ',60))
        assert ready['pid'] == ingress.proc.pid
        assert ready['productionService'] and ready['trustedFinalizedState']
        write_json(output/'ingress-ready.json', ready)
        host.send({'command':'configure','route':ready['route'],'chainId':ready['chainId']})
        host.marker('NEC93_HOST_CONFIGURED',5)
        client_config = output/'client-config.json'
        write_json(client_config, {'certFile':str(cert),'outputDir':str(output),'route':ready['route'],
                                  'chainId':ready['chainId'],'ingressURL':ready['ingressURL'],
                                  'selectedURL':endpoint['url'],'selectedPin':endpoint['pin']})
        client = Role('client',[node,'-r',str(register),str(HERE/'client.cjs'),str(client_config)],env,output)
        roles.append(client)
        done = json.loads(client.marker('NEC93_CLIENT_DONE ',60))
        assert done['pid'] == client.proc.pid
        client.wait(5)
        ingress.send('\n'); ingress.wait(10)
        host.send({'command':'stop'}); host.wait(5)
        result = assert_complete(output)
        result['sourceConfig']={'sdk':str(SDK),'goTestBinary':str(binary),'node':str(node),'tsNodeRegister':str(register)}
        write_json(output/'RESULT.json', result)
        print(json.dumps(result))
    except Exception as error:
        write_json(output/'FAILED.json', {'ok':False,'BASIC':0,'error':str(error)})
        raise
    finally:
        for role in reversed(roles):
            role.cleanup()


if __name__ == '__main__':
    main()
