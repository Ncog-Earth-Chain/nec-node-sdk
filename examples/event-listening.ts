import { Contract } from '../src/contract';
import { Provider } from '../src/provider';

// Example ABI with events
const contractABI = [
  // Function examples
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "message",
        "type": "string"
      }
    ],
    "name": "sendMessage",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "transfer",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  // Event examples
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "message",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "name": "MessageSent",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "Transfer",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "user",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "balance",
        "type": "uint256"
      }
    ],
    "name": "BalanceUpdated",
    "type": "event"
  }
];

async function demonstrateEventListening() {
  // Initialize provider and contract
  const provider = new Provider('https://your-rpc-endpoint');
  const contract = new Contract('0xYourContractAddress', contractABI, provider);

  console.log('=== Smart Contract Event Listening Examples ===\n');

  // Example 1: Basic event listening with fallback (web3.js style)
  console.log('1. Basic event listening with WebSocket fallback...');
  
  const messageEvent = contract.events.MessageSent({
    fromBlock: 'latest',
    filter: {
      sender: '0x1234567890abcdef' // Optional: filter by specific sender
    },
    enablePolling: true,      // Enable polling fallback (default: true)
    pollingInterval: 3000     // Poll every 3 seconds (default: 5000)
  });

  messageEvent.on('data', (event) => {
    console.log('📨 New message received:');
    console.log('  Sender:', event.returnValues.sender);
    console.log('  Message:', event.returnValues.message);
    console.log('  Timestamp:', event.returnValues.timestamp);
    console.log('  Block number:', event.blockNumber);
    console.log('  Transaction hash:', event.transactionHash);
    console.log('  Log index:', event.logIndex);
  });

  messageEvent.on('error', (error) => {
    console.error('❌ Event error:', error);
  });

  // Example 2: Transfer event listening with filters
  console.log('\n2. Transfer event listening with filters...');
  
  const transferEvent = contract.events.Transfer({
    fromBlock: 0, // Listen from genesis block
    filter: {
      from: '0xYourAddress', // Filter transfers from specific address
      to: '0xAnotherAddress'  // Filter transfers to specific address
    }
  });

  transferEvent.on('data', (event) => {
    console.log('💰 Transfer detected:');
    console.log('  From:', event.returnValues.from);
    console.log('  To:', event.returnValues.to);
    console.log('  Amount:', event.returnValues.amount);
    console.log('  Block:', event.blockNumber);
    console.log('  TX Hash:', event.transactionHash);
  });

  // Example 3: Balance updates without filters
  console.log('\n3. Balance updates (all events)...');
  
  const balanceEvent = contract.events.BalanceUpdated({
    fromBlock: 'latest' // Only listen to new events
  });

  balanceEvent.on('data', (event) => {
    console.log('💳 Balance updated:');
    console.log('  User:', event.returnValues.user);
    console.log('  New Balance:', event.returnValues.balance);
    console.log('  Block:', event.blockNumber);
  });

  // Example 4: Listening to all events from a specific block range
  console.log('\n4. Historical events from block range...');
  
  const historicalEvents = contract.events.MessageSent({
    fromBlock: 1000000, // Start from block 1,000,000
    toBlock: 1000100    // End at block 1,000,100
  });

  historicalEvents.on('data', (event) => {
    console.log('📚 Historical message:');
    console.log('  Sender:', event.returnValues.sender);
    console.log('  Message:', event.returnValues.message);
    console.log('  Block:', event.blockNumber);
  });

  // Example 5: Multiple event types simultaneously
  console.log('\n5. Listening to multiple event types...');
  
  const events = ['MessageSent', 'Transfer', 'BalanceUpdated'];
  
  events.forEach(eventName => {
    const eventStream = contract.events[eventName]({
      fromBlock: 'latest'
    });
    
    eventStream.on('data', (event) => {
      console.log(`🎯 ${eventName} event:`, {
        eventName,
        returnValues: event.returnValues,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash
      });
    });
    
    eventStream.on('error', (error) => {
      console.error(`❌ ${eventName} event error:`, error);
    });
  });

  // Example 6: Event listening with error handling and cleanup
  console.log('\n6. Event listening with proper cleanup...');
  
  const cleanupExample = contract.events.MessageSent({
    fromBlock: 'latest'
  });

  const dataHandler = (event: any) => {
    console.log('🔔 Message event (with cleanup):', event.returnValues);
  };

  const errorHandler = (error: any) => {
    console.error('❌ Error in cleanup example:', error);
  };

  cleanupExample.on('data', dataHandler);
  cleanupExample.on('error', errorHandler);

  // Simulate cleanup after some time
  setTimeout(async () => {
    console.log('\n🧹 Cleaning up event listeners...');
    
    // Remove specific handlers
    cleanupExample.off('data', dataHandler);
    cleanupExample.off('error', errorHandler);
    
    // Stop the event stream
    await cleanupExample.stop();
    
    console.log('✅ Event listeners cleaned up');
  }, 30000); // Clean up after 30 seconds

  // Example 7: Real-time event monitoring with reconnection logic
  console.log('\n7. Real-time monitoring with reconnection...');
  
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;

  function setupRealtimeMonitoring() {
    const realtimeEvent = contract.events.Transfer({
      fromBlock: 'latest'
    });

    realtimeEvent.on('data', (event) => {
      console.log('⚡ Real-time transfer:', {
        from: event.returnValues.from,
        to: event.returnValues.to,
        amount: event.returnValues.amount,
        timestamp: new Date().toISOString()
      });
      reconnectAttempts = 0; // Reset on successful event
    });

    realtimeEvent.on('error', async (error) => {
      console.error('❌ Real-time monitoring error:', error);
      reconnectAttempts++;
      
      if (reconnectAttempts < maxReconnectAttempts) {
        console.log(`🔄 Attempting to reconnect (${reconnectAttempts}/${maxReconnectAttempts})...`);
        await realtimeEvent.stop();
        
        setTimeout(() => {
          setupRealtimeMonitoring();
        }, 5000); // Wait 5 seconds before reconnecting
      } else {
        console.error('❌ Max reconnection attempts reached');
      }
    });

    return realtimeEvent;
  }

  const realtimeMonitoring = setupRealtimeMonitoring();

  // Example 8: Event aggregation and statistics
  console.log('\n8. Event aggregation and statistics...');
  
  const eventStats = {
    messageCount: 0,
    transferCount: 0,
    totalTransferred: 0,
    uniqueSenders: new Set(),
    uniqueReceivers: new Set()
  };

  const statsEvent = contract.events.Transfer({
    fromBlock: 'latest'
  });

  statsEvent.on('data', (event) => {
    eventStats.transferCount++;
    eventStats.totalTransferred += parseInt(event.returnValues.amount);
    eventStats.uniqueSenders.add(event.returnValues.from);
    eventStats.uniqueReceivers.add(event.returnValues.to);
    
    console.log('📊 Transfer Statistics:');
    console.log('  Total transfers:', eventStats.transferCount);
    console.log('  Total amount transferred:', eventStats.totalTransferred);
    console.log('  Unique senders:', eventStats.uniqueSenders.size);
    console.log('  Unique receivers:', eventStats.uniqueReceivers.size);
  });

  // Keep the process running to demonstrate event listening
  console.log('\n🚀 Event listeners are now active. Press Ctrl+C to stop.');
  console.log('📝 Note: Replace "https://your-rpc-endpoint" and "0xYourContractAddress" with actual values.');
}

// Example 10: Fallback functionality demonstration
async function demonstrateFallbackFunctionality() {
  const provider = new Provider('https://your-rpc-endpoint');
  const contract = new Contract('0xYourContractAddress', contractABI, provider);

  console.log('\n=== Fallback Functionality Examples ===\n');

  // Example A: WebSocket with polling fallback (default behavior)
  console.log('A. WebSocket with polling fallback (default)...');
  const fallbackEvent = contract.events.Transfer({
    fromBlock: 'latest',
    enablePolling: true,      // Enable polling fallback
    pollingInterval: 2000     // Poll every 2 seconds
  });

  fallbackEvent.on('data', (event) => {
    console.log('🔄 Transfer event (with fallback):', event.returnValues);
    
    // Check connection status
    const status = fallbackEvent.getConnectionStatus();
    console.log('📊 Connection status:', status);
  });

  // Example B: WebSocket only (no fallback)
  console.log('\nB. WebSocket only (no fallback)...');
  const websocketOnlyEvent = contract.events.MessageSent({
    fromBlock: 'latest',
    enablePolling: false      // Disable polling fallback
  });

  websocketOnlyEvent.on('data', (event) => {
    console.log('📨 Message event (WebSocket only):', event.returnValues);
  });

  websocketOnlyEvent.on('error', (error) => {
    console.error('❌ WebSocket only event error:', error);
  });

  // Example C: Polling only (for environments without WebSocket support)
  console.log('\nC. Polling only mode...');
  const pollingOnlyEvent = contract.events.BalanceUpdated({
    fromBlock: 'latest',
    enablePolling: true,
    pollingInterval: 1000     // Poll every 1 second
  });

  // Force polling mode by simulating WebSocket failure
  setTimeout(() => {
    const status = pollingOnlyEvent.getConnectionStatus();
    console.log('📊 Polling only status:', status);
  }, 1000);

  // Example D: Connection status monitoring
  console.log('\nD. Connection status monitoring...');
  const monitoredEvent = contract.events.Transfer({
    fromBlock: 'latest'
  });

  // Monitor connection status every 10 seconds
  const statusInterval = setInterval(() => {
    const status = monitoredEvent.getConnectionStatus();
    console.log('📊 Connection status update:', {
      active: status.active,
      usePolling: status.usePolling,
      hasSubscription: status.hasSubscription,
      hasPollingInterval: status.hasPollingInterval
    });
  }, 10000);

  // Cleanup after 60 seconds
  setTimeout(async () => {
    clearInterval(statusInterval);
    await fallbackEvent.stop();
    await websocketOnlyEvent.stop();
    await pollingOnlyEvent.stop();
    await monitoredEvent.stop();
    console.log('🧹 Fallback examples cleaned up');
  }, 60000);
}

// Example 9: Correct event access pattern (fixing common mistakes)
async function demonstrateCorrectEventAccess() {
  const provider = new Provider('https://your-rpc-endpoint');
  const contract = new Contract('0xYourContractAddress', contractABI, provider);

  console.log('\n=== Correct Event Access Pattern ===\n');

  // ❌ WRONG: This won't work
  // const eventListener = contract.events?.EventAddedOrEdited;
  // if (eventListener) {
  //   eventListener().on("data", async (event) => {
  //     // This will fail because eventListener() returns undefined
  //   });
  // }

  // ✅ CORRECT: Call the event function with options
  const eventListener = contract.events.EventAddedOrEdited;
  if (eventListener) {
    // Call the function with options (even empty options)
    const eventStream = eventListener({
      fromBlock: 'latest'
    });
    
    eventStream.on("data", async (event) => {
      console.log('📅 Event added or edited:', event.returnValues);
      
      // Your logic here
      if (event.returnValues.username === 'active') {
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('🔄 Refreshing calendar events...');
        // setEventsOnCalendar();
      }
    });

    eventStream.on("error", (error) => {
      console.error('❌ Event error:', error);
    });
  } else {
    console.error("EventAddedOrEdited is not defined in ABI or Web3 setup.");
  }

  // Alternative: Direct access without optional chaining
  if (contract.events.EventAddedOrEdited) {
    const eventStream2 = contract.events.EventAddedOrEdited({
      fromBlock: 'latest'
    });
    
    eventStream2.on("data", async (event) => {
      console.log('📅 Direct access event:', event.returnValues);
    });
  }

  // For your specific use case:
  console.log('\n=== Your Specific Use Case Fixed ===\n');
  
  // ✅ CORRECT VERSION of your code:
  const calendarsContract = new Contract('0xYourContractAddress', contractABI, provider);
  const active = 'your_active_username';
  
  const calendarEventListener = calendarsContract.events.EventAddedOrEdited;
  if (calendarEventListener) {
    // Call the function with options
    const eventStream = calendarEventListener({
      fromBlock: 'latest'
    });
    
    eventStream.on("data", async (event) => {
      if (event.returnValues.username === active) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('🔄 Refreshing calendar events for user:', active);
        // setEventsOnCalendar();
      }
    });

    eventStream.on("error", (error) => {
      console.error('❌ Calendar event error:', error);
    });
  } else {
    console.error("EventAddedOrEdited is not defined in ABI or Web3 setup.");
  }
}

// TypeScript interfaces for type safety
interface MessageSentEvent {
  sender: string;
  message: string;
  timestamp: string;
}

interface TransferEvent {
  from: string;
  to: string;
  amount: string;
}

interface BalanceUpdatedEvent {
  user: string;
  balance: string;
}

// Export for use in other files
export {
  demonstrateEventListening,
  demonstrateFallbackFunctionality,
  contractABI,
  MessageSentEvent,
  TransferEvent,
  BalanceUpdatedEvent
};

// Run the example if this file is executed directly
if (require.main === module) {
  demonstrateEventListening().catch(console.error);
}
