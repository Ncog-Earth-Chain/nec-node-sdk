// --- Subscription class for WebSocket event subscriptions ---

// Type for event handlers
export interface EventHandler {
  (data: any): void;
}

// Type for subscription handlers
export interface SubscriptionHandler {
  (data: any): void;
}

// Environment detection
const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

export class Subscription {
  private ws: any; // WebSocket (browser) or ws (Node.js)
  private url: string;
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();
  private subscriptionHandlers: Map<string, SubscriptionHandler> = new Map();
  private isConnected: boolean = false;
  private idCounter: number = 1;
  private pendingRequests: Map<number, { resolve: Function; reject: Function } > = new Map();

  constructor(url: string) {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isConnected) {
        resolve();
        return;
      }
      if (isNode) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const WS = require('ws');
        this.ws = new WS(this.url);
      } else if (isBrowser) {
        this.ws = new window.WebSocket(this.url);
      } else {
        reject(new Error('Unsupported environment for WebSocket'));
        return;
      }
      this.ws.onopen = () => {
        this.isConnected = true;
        this.emit('open');
        resolve();
      };
      this.ws.onclose = (event: any) => {
        this.isConnected = false;
        this.emit('close', event);
      };
      this.ws.onerror = (event: any) => {
        this.emit('error', event);
        if (!this.isConnected) reject(event);
      };
      this.ws.onmessage = (event: any) => {
        let data = event.data;
        if (isNode && Buffer.isBuffer(data)) {
          data = data.toString('utf8');
        }
        try {
          const msg = JSON.parse(data);
          // Handle JSON-RPC response or subscription
          if (msg.id && this.pendingRequests.has(msg.id)) {
            const { resolve, reject } = this.pendingRequests.get(msg.id)!;
            this.pendingRequests.delete(msg.id);
            if (msg.error) reject(msg.error);
            else resolve(msg.result);
          } else if (msg.method === 'eth_subscription' && msg.params) {
            const subId = msg.params.subscription;
            const handler = this.subscriptionHandlers.get(subId);
            if (handler) handler(msg.params.result);
          } else {
            this.emit('message', msg);
          }
        } catch (err) {
          this.emit('error', err);
        }
      };
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }

  on(event: string, handler: EventHandler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: string, handler: EventHandler) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event)!.delete(handler);
    }
  }

  private emit(event: string, ...args: any[]) {
    if (this.eventHandlers.has(event)) {
      for (const handler of this.eventHandlers.get(event)!) {
        handler(args[0]);
      }
    }
  }

  sendRpc(method: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error('WebSocket is not connected'));
        return;
      }
      const id = this.idCounter++;
      const payload = { jsonrpc: '2.0', id, method, params };
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  async subscribe(subType: string, params: any[] = [], handler: SubscriptionHandler): Promise<string> {
    const subId = await this.sendRpc('eth_subscribe', [subType, ...params]);
    this.subscriptionHandlers.set(subId, handler);
    return subId;
  }

  async unsubscribe(subId: string): Promise<boolean> {
    const result = await this.sendRpc('eth_unsubscribe', [subId]);
    this.subscriptionHandlers.delete(subId);
    return result;
  }
} 