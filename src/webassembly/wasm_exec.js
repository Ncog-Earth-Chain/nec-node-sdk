// Go WebAssembly runtime for browser environments
// This is a browser-compatible version of the Go WASM runtime

(function() {
  "use strict";

  // Check if we're in a browser environment
  if (typeof window === 'undefined' && typeof global === 'undefined') {
    throw new Error('This runtime is designed for browser environments');
  }

  const global = (typeof window !== 'undefined' ? window : global);

  // Go runtime implementation
  class Go {
    constructor() {
      this.argv = [];
      this.env = {};
      this.exit = (code) => {
        if (code !== 0) {
          console.warn('exit code:', code);
        }
      };
      this._callbackTimeouts = new Map();
      this._nextCallbackTimeoutID = 1;

      const mem = () => {
        const buffer = new ArrayBuffer(this._inst.exports.mem.buffer.byteLength);
        const u8 = new Uint8Array(buffer);
        const u16 = new Uint16Array(buffer);
        const u32 = new Uint32Array(buffer);
        const f32 = new Float32Array(buffer);
        const f64 = new Float64Array(buffer);
        const setInt64 = (addr, v) => {
          u32[addr + 4] = v;
          u32[addr] = (v / 4294967296) | 0;
        };
        const getInt64 = (addr) => {
          const low = u32[addr];
          const high = u32[addr + 4];
          return low + high * 4294967296;
        };
        const setUint64 = (addr, v) => {
          u32[addr + 4] = v;
          u32[addr] = (v / 4294967296) >>> 0;
        };
        const getUint64 = (addr) => {
          const low = u32[addr];
          const high = u32[addr + 4];
          return low + high * 4294967296;
        };

        return {
          buffer: buffer,
          u8: u8,
          u16: u16,
          u32: u32,
          u64: new BigUint64Array(buffer),
          f32: f32,
          f64: f64,
          setInt64: setInt64,
          getInt64: getInt64,
          setUint64: setUint64,
          getUint64: getUint64,
        };
      };

      this._inst = null;
      this._values = new Map();
      this._goRefCounts = new Map();
      this._ids = new Map();
      this._idPool = (() => {
        let ids = [];
        return {
          get: () => {
            if (ids.length === 0) {
              ids = new Array(16);
              for (let i = 0; i < 16; i++) {
                ids[i] = 1 + i;
              }
            }
            return ids.pop();
          },
          put: (id) => {
            ids.push(id);
          },
        };
      })();
      this._mem = mem();
      this._lastSP = 0;
    }

    importObject = {
      go: {
        js: {
          mem: this._mem,
          setInt64: this._mem.setInt64,
          getInt64: this._mem.getInt64,
          setUint64: this._mem.setUint64,
          getUint64: this._mem.getUint64,
          debug: (value) => {
            console.log(value);
          },
        },
      },
    };

    run(instance) {
      this._inst = instance;
      this._mem = new DataView(this._inst.exports.mem.buffer);
      this._values = new Map();
      this._goRefCounts = new Map();
      this._ids = new Map();
      this._idPool = (() => {
        let ids = [];
        return {
          get: () => {
            if (ids.length === 0) {
              ids = new Array(16);
              for (let i = 0; i < 16; i++) {
                ids[i] = 1 + i;
              }
            }
            return ids.pop();
          },
          put: (id) => {
            ids.push(id);
          },
        };
      })();

      const setInt64 = (addr, v) => {
        this._mem.setUint32(addr + 4, v, true);
        this._mem.setUint32(addr, (v / 4294967296) | 0, true);
      };
      const getInt64 = (addr) => {
        const low = this._mem.getUint32(addr, true);
        const high = this._mem.getInt32(addr + 4, true);
        return low + high * 4294967296;
      };
      const setUint64 = (addr, v) => {
        this._mem.setUint32(addr + 4, v, true);
        this._mem.setUint32(addr, (v / 4294967296) >>> 0, true);
      };
      const getUint64 = (addr) => {
        const low = this._mem.getUint32(addr, true);
        const high = this._mem.getUint32(addr + 4, true);
        return low + high * 4294967296;
      };

      this._mem.setInt64 = setInt64;
      this._mem.getInt64 = getInt64;
      this._mem.setUint64 = setUint64;
      this._mem.getUint64 = getUint64;

      this._inst.exports.run();
    }
  }

  // Make Go available globally
  global.Go = Go;
})(); 