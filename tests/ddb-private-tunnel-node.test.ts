import { ownDdbPrivateTunnelRoute, projectDdbPrivateTunnelRoute } from '../src/ddb-private-tunnel-node';

const hash = '0x' + '12'.repeat(32), address = '0x' + '34'.repeat(20);
const route = { format: 'private-tunnel-route-v1' as const, audience: 'current' as const, chainId: '0x1', contract: address,
  manager: address, runtimeHash: hash, placementVersion: '0x1', groupHash: hash, validatorId: '0x1', assignmentBlockHash: hash };

test('closed public route owns canonical fields and refuses private context or target injection', () => {
  expect(ownDdbPrivateTunnelRoute(route)).toEqual(route);
  for (const bad of [{ ...route, url: 'https://169.254.169.254' }, { ...route, context: { policy: 'private' } },
    { ...route, chainId: '0x01' }, { ...route, validatorId: '0x100000000' }, { ...route, audience: 'CONNECT' }]) {
    expect(() => ownDdbPrivateTunnelRoute(bad as any)).toThrow();
  }
  const assignment = { contract: address, manager: address, runtimeHash: hash, version: '0x1', groupHash: hash, blockHash: hash,
    database: 'c_' + address.slice(2), enabled: true, private: true, block: '0x1', epoch: '0x1', stateRoot: hash,
    members: [{ validatorId: 1, address }] };
  expect(projectDdbPrivateTunnelRoute('0x1', assignment, 1)).toEqual(route);
  expect(JSON.stringify(projectDdbPrivateTunnelRoute('0x1', { ...assignment, policy: 'private sentinel' } as any, 1))).not.toContain('sentinel');
});
