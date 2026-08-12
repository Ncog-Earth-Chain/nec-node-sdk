# Subscription Function Reference

## Interfaces

### EventHandler Interface

**Structure:**
```typescript
interface EventHandler {
  (data: any): void;
}
```

**Description:** Type definition for event handlers that process subscription events.

**Parameters:**
- `data` (any): Event data passed to the handler

### SubscriptionHandler Interface

**Structure:**
```typescript
interface SubscriptionHandler {
  (data: any): void;
}
```

**Description:** Type definition for subscription handlers that process specific subscription data.

**Parameters:**
- `data` (any): Subscription data passed to the handler

## Environment Detection

The module automatically detects the runtime environment to use the appropriate WebSocket implementation:

- **Node.js**: Uses the `ws` library
- **React Native**: Uses the built-in global WebSocket
- **Browser**: Uses `window.WebSocket`

## Subscription Class

### Constructor

**Function:** `constructor(url: string)`

**Description:** Creates a new Subscription instance for WebSocket connections.

**Input Parameters:**
- `url` (string): WebSocket server URL to connect to

**Response:** Creates a new Subscription instance

**Example:**
```typescript
const subscription = new Subscription('wss://mainnet.infura.io/ws/v3/YOUR_PROJECT_ID');
```

### Properties

- `ws` (any): WebSocket instance (private)
- `url` (string): WebSocket server URL
- `eventHandlers` (Map<string, Set<EventHandler>>): Map of event handlers (private)
- `subscriptionHandlers` (Map<string, SubscriptionHandler>): Map of subscription handlers (private)
- `isConnected` (boolean): Connection status (private)
- `idCounter` (number): Counter for RPC request IDs (private)
- `pendingRequests` (Map<number, { resolve: Function; reject: Function }>): Pending RPC requests (private)

## Connection Methods

### connect

**Function:** `connect(): Promise<void>`

**Description:** Establishes a WebSocket connection to the specified URL. Automatically handles environment detection and WebSocket implementation selection.

**Input Parameters:** None

**Response:** Promise<void> - Resolves when connection is established

**Error Handling:**
- Rejects if WebSocket connection fails
- Rejects if environment is unsupported
- Rejects if connection setup fails

**Events Emitted:**
- `open`: When connection is established
- `close`: When connection is closed
- `error`: When connection error occurs
- `message`: When message is received

**Example:**
```typescript
try {
  await subscription.connect();
  console.log('Connected to WebSocket');
} catch (error) {
  console.error('Connection failed:', error);
}
```

### disconnect

**Function:** `disconnect(): void`

**Description:** Closes the WebSocket connection and cleans up resources.

**Input Parameters:** None

**Response:** void

**Example:**
```typescript
subscription.disconnect();
```

## Event Handling Methods

### on

**Function:** `on(event: string, handler: EventHandler): void`

**Description:** Registers an event handler for a specific event type.

**Input Parameters:**
- `event` (string): Event type to listen for (e.g., 'open', 'close', 'error', 'message')
- `handler` (EventHandler): Function to call when the event occurs

**Response:** void

**Example:**
```typescript
subscription.on('open', () => {
  console.log('WebSocket connection opened');
});

subscription.on('message', (data) => {
  console.log('Received message:', data);
});

subscription.on('error', (error) => {
  console.error('WebSocket error:', error);
});
```

### off

**Function:** `off(event: string, handler: EventHandler): void`

**Description:** Removes a specific event handler for an event type.

**Input Parameters:**
- `event` (string): Event type to remove handler from
- `handler` (EventHandler): Specific handler function to remove

**Response:** void

**Example:**
```typescript
const messageHandler = (data) => console.log('Message:', data);
subscription.on('message', messageHandler);

// Later, remove the handler
subscription.off('message', messageHandler);
```

### emit (Private)

**Function:** `private emit(event: string, ...args: any[]): void`

**Description:** Internal method to emit events to registered handlers.

**Input Parameters:**
- `event` (string): Event type to emit
- `...args` (any[]): Arguments to pass to event handlers

**Response:** void

**Note:** This is a private method used internally by the class.

## RPC Communication Methods

### sendRpc

**Function:** `sendRpc(method: string, params: any[] = []): Promise<any>`

**Description:** Sends a JSON-RPC request over the WebSocket connection and returns a promise that resolves with the response.

**Input Parameters:**
- `method` (string): RPC method name
- `params` (any[], optional): RPC method parameters (defaults to empty array)

**Response:** Promise<any> - RPC response result

**Error Handling:**
- Rejects if WebSocket is not connected
- Rejects if RPC call returns an error
- Rejects if connection fails

**Example:**
```typescript
try {
  const result = await subscription.sendRpc('eth_blockNumber', []);
  console.log('Current block number:', result);
} catch (error) {
  console.error('RPC call failed:', error);
}
```

## Subscription Management Methods

### subscribe

**Function:** `subscribe(subType: string, params: any[] = [], handler: SubscriptionHandler): Promise<string>`

**Description:** Subscribes to a specific event type and registers a handler for incoming subscription data.

**Input Parameters:**
- `subType` (string): Subscription type (e.g., 'newHeads', 'logs')
- `params` (any[], optional): Subscription parameters (defaults to empty array)
- `handler` (SubscriptionHandler): Function to call when subscription data is received

**Response:** Promise<string> - Subscription ID

**Error Handling:**
- Rejects if WebSocket is not connected
- Rejects if subscription request fails

**Example:**
```typescript
// Subscribe to new block headers
const subId = await subscription.subscribe('newHeads', [], (blockHeader) => {
  console.log('New block:', blockHeader);
});

// Subscribe to logs with filter
const logSubId = await subscription.subscribe('logs', [{
  address: '0x1234567890123456789012345678901234567890',
  topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
}], (logs) => {
  console.log('New logs:', logs);
});
```

### unsubscribe

**Function:** `unsubscribe(subId: string): Promise<boolean>`

**Description:** Unsubscribes from a specific subscription and removes its handler.

**Input Parameters:**
- `subId` (string): Subscription ID to unsubscribe from

**Response:** Promise<boolean> - True if unsubscription was successful

**Error Handling:**
- Rejects if WebSocket is not connected
- Rejects if unsubscription request fails

**Example:**
```typescript
// Unsubscribe from a subscription
const success = await subscription.unsubscribe(subId);
if (success) {
  console.log('Successfully unsubscribed');
}
```

## Usage Examples

### Basic WebSocket Connection and Event Handling

```typescript
import { Subscription } from '@ncog/necjs';

// Create subscription instance
const subscription = new Subscription('wss://mainnet.infura.io/ws/v3/YOUR_PROJECT_ID');

// Set up event handlers
subscription.on('open', () => {
  console.log('Connected to WebSocket');
});

subscription.on('close', (event) => {
  console.log('Connection closed:', event);
});

subscription.on('error', (error) => {
  console.error('WebSocket error:', error);
});

// Connect to WebSocket
await subscription.connect();
```

### Subscribing to Blockchain Events

```typescript
// Subscribe to new block headers
const blockSubId = await subscription.subscribe('newHeads', [], (blockHeader) => {
  console.log('New block:', {
    number: blockHeader.number,
    hash: blockHeader.hash,
    timestamp: blockHeader.timestamp
  });
});

// Subscribe to logs with filter
const logSubId = await subscription.subscribe('logs', [{
  address: '0x1234567890123456789012345678901234567890',
  topics: [
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' // Transfer event
  ]
}], (logs) => {
  logs.forEach(log => {
    console.log('Transfer event:', {
      from: log.topics[1],
      to: log.topics[2],
      value: log.data
    });
  });
});
```

### RPC Calls Over WebSocket

```typescript
// Get current block number
const blockNumber = await subscription.sendRpc('eth_blockNumber', []);
console.log('Current block:', blockNumber);

// Get account balance
const balance = await subscription.sendRpc('eth_getBalance', [
  '0x1234567890123456789012345678901234567890',
  'latest'
]);
console.log('Balance:', balance);

// Get transaction count
const nonce = await subscription.sendRpc('eth_getTransactionCount', [
  '0x1234567890123456789012345678901234567890',
  'latest'
]);
console.log('Nonce:', nonce);
```

### Managing Multiple Subscriptions

```typescript
// Store subscription IDs for later cleanup
const subscriptions = [];

// Subscribe to multiple events
const blockSub = await subscription.subscribe('newHeads', [], (data) => {
  console.log('Block:', data);
});
subscriptions.push(blockSub);

// Later, unsubscribe from all
for (const subId of subscriptions) {
  await subscription.unsubscribe(subId);
}

// Disconnect when done
subscription.disconnect();
```

### Error Handling and Reconnection

```typescript
subscription.on('error', (error) => {
  console.error('WebSocket error:', error);
  // Implement reconnection logic if needed
});

subscription.on('close', (event) => {
  console.log('Connection closed, attempting to reconnect...');
  setTimeout(async () => {
    try {
      await subscription.connect();
      console.log('Reconnected successfully');
    } catch (error) {
      console.error('Reconnection failed:', error);
    }
  }, 5000);
});
``` 