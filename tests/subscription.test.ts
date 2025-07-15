import { Subscription } from '../src/subscription';

let mockWs: any;
jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => mockWs);
});

describe('Subscription', () => {
  let sub: Subscription;
  const url = 'ws://localhost:8546';

  beforeEach(() => {
    mockWs = {
      close: jest.fn(),
      send: jest.fn(),
      onopen: undefined,
      onclose: undefined,
      onerror: undefined,
      onmessage: undefined,
    };
    (global as any).window = { WebSocket: jest.fn(() => mockWs) };
    sub = new Subscription(url);
  });

  afterEach(() => {
    delete (global as any).window;
  });

  it('connects and emits open event', async () => {
    const openHandler = jest.fn();
    sub.on('open', openHandler);
    const connectPromise = sub.connect();
    // Simulate the WebSocket opening
    setTimeout(() => {
      if (typeof mockWs.onopen === 'function') mockWs.onopen();
    }, 0);
    await expect(connectPromise).resolves.toBeUndefined();
    expect(openHandler).toHaveBeenCalled();
  });

  it('disconnects and closes websocket', () => {
    sub['ws'] = mockWs;
    sub['isConnected'] = true;
    sub.disconnect();
    expect(mockWs.close).toHaveBeenCalled();
    expect(sub['isConnected']).toBe(false);
  });

  it('registers and unregisters event handlers', () => {
    const handler = jest.fn();
    sub.on('message', handler);
    // @ts-ignore
    sub.emit('message', { foo: 'bar' });
    expect(handler).toHaveBeenCalledWith({ foo: 'bar' });
    sub.off('message', handler);
    // @ts-ignore
    sub.emit('message', { foo: 'baz' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('sendRpc sends payload and resolves on response', async () => {
    sub['ws'] = mockWs;
    sub['isConnected'] = true;
    const promise = sub.sendRpc('test_method', [1, 2]);
    const id = sub['idCounter'] - 1;
    expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('test_method'));
    // Simulate response
    sub['pendingRequests'].get(id)!.resolve('ok');
    await expect(promise).resolves.toBe('ok');
  });

  it('subscribe and unsubscribe', async () => {
    sub['ws'] = mockWs;
    sub['isConnected'] = true;
    sub.sendRpc = jest.fn().mockResolvedValue('subid');
    const handler = jest.fn();
    const subId = await sub.subscribe('logs', [], handler);
    expect(subId).toBe('subid');
    expect(sub['subscriptionHandlers'].get('subid')).toBe(handler);
    (sub.sendRpc as jest.Mock).mockResolvedValue(true);
    const result = await sub.unsubscribe('subid');
    expect(result).toBe(true);
    expect(sub['subscriptionHandlers'].has('subid')).toBe(false);
  });
}); 