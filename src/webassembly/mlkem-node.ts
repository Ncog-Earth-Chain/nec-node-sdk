import fs from 'fs';
import { createRequire } from 'node:module';
import path from 'path';
import { webcrypto } from 'node:crypto';

// --- Custom Go class type for TypeScript ---
interface GoRuntime {
  argv: string[];
  env: Record<string, string>;
  exit: (code: number) => void;
  _exitPromise: Promise<void>;
  _resolveExitPromise: () => void;
  _pendingEvent: any;
  _scheduledTimeouts: Map<number, any>;
  _nextCallbackTimeoutID: number;
  mem: DataView;
  _inst?: any;
  _values?: any[];
  _goRefCounts?: number[];
  _ids?: Map<number | null, number>;
  _idPool?: number[];
  exited?: boolean;
  importObject: any;
  run: (instance: WebAssembly.Instance) => Promise<void>;
  _resume: () => void;
  _makeFuncWrapper: (id: number) => (...args: any[]) => any;
}

function createGoRuntime() {
"use strict";
const enosys = () => {
		const err = new Error("not implemented") as Error & { code?: string };
		err.code = "ENOSYS";
		return err;
	};

	if (!globalThis.fs) {
		let outputBuf = "";
		// Use type assertion to satisfy NodeJS 'fs' type
		globalThis.fs = {
			constants: Object.assign({}, fs.constants, { O_WRONLY: -1, O_RDWR: -1, O_CREAT: -1, O_TRUNC: -1, O_APPEND: -1, O_EXCL: -1, O_DIRECTORY: -1 }),
			writeSync(fd: number, buf: Buffer | ArrayBufferView) {
				// Accept Buffer or ArrayBufferView, decode as needed
				const decoder = new TextDecoder();
				let toDecode: Uint8Array;
				if (typeof buf === 'string') {
					toDecode = new TextEncoder().encode(buf);
				} else if (buf instanceof Uint8Array) {
					toDecode = buf;
				} else if (ArrayBuffer.isView(buf)) {
					toDecode = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
				} else {
					toDecode = new Uint8Array(0);
				}
				outputBuf += decoder.decode(toDecode);
				const nl = outputBuf.lastIndexOf("\n");
				if (nl != -1) {
					console.log(outputBuf.substring(0, nl));
					outputBuf = outputBuf.substring(nl + 1);
				}
				return toDecode.length;
			},
			write(fd: number, buf: Buffer | ArrayBufferView, offset: number, length: number, position: number | null, callback: (err: Error | null, written?: number, buffer?: Buffer | ArrayBufferView) => void) {
				if (offset !== 0 || length !== (buf as ArrayBufferView).byteLength || position !== null) {
					callback(enosys(), 0, buf);
					return;
				}
				const n = (this as any).writeSync(fd, buf);
				callback(null, n, buf);
			},
			chmod(path: any, mode: any, callback: any) { callback(enosys()); },
			chown(path: any, uid: any, gid: any, callback: any) { callback(enosys()); },
			close(fd: any, callback: any) { callback(enosys()); },
			fchmod(fd: any, mode: any, callback: any) { callback(enosys()); },
			fchown(fd: any, uid: any, gid: any, callback: any) { callback(enosys()); },
			fstat(fd: any, callback: any) { callback(enosys()); },
			fsync(fd: any, callback: any) { callback(null); },
			ftruncate(fd: any, length: any, callback: any) { callback(enosys()); },
			lchown(path: any, uid: any, gid: any, callback: any) { callback(enosys()); },
			link(path: any, link: any, callback: any) { callback(enosys()); },
			lstat(path: any, callback: any) { callback(enosys()); },
			mkdir(path: any, perm: any, callback: any) { callback(enosys()); },
			open(path: any, flags: any, mode: any, callback: any) { callback(enosys()); },
			read(fd: any, buffer: any, offset: any, length: any, position: any, callback: any) { callback(enosys()); },
			readdir(path: any, callback: any) { callback(enosys()); },
			readlink(path: any, callback: any) { callback(enosys()); },
			rename(from: any, to: any, callback: any) { callback(enosys()); },
			rmdir(path: any, callback: any) { callback(enosys()); },
			stat(path: any, callback: any) { callback(enosys()); },
			symlink(path: any, link: any, callback: any) { callback(enosys()); },
			truncate(path: any, length: any, callback: any) { callback(enosys()); },
			unlink(path: any, callback: any) { callback(enosys()); },
			utimes(path: any, atime: any, mtime: any, callback: any) { callback(enosys()); },
		} as any;
	}

	if (!globalThis.process) {
		globalThis.process = Object.assign({
			getuid() { return -1; },
			getgid() { return -1; },
			geteuid() { return -1; },
			getegid() { return -1; },
			getgroups() { throw enosys(); },
			pid: -1,
			ppid: -1,
			umask() { throw enosys(); },
			cwd() { throw enosys(); },
			chdir() { throw enosys(); },
			// Add minimal required properties for type compatibility
			stdout: null,
			stderr: null,
			stdin: null,
			argv: [],
			env: {},
			exit: () => {},
			version: '',
			versions: {},
			platform: '',
			arch: '',
			title: '',
			memoryUsage: () => ({}),
			nextTick: (cb: any) => setTimeout(cb, 0),
			on: () => {},
			emit: () => false,
			removeListener: () => {},
			listeners: () => [],
			// ...add more as needed
		}, {}) as any;
	}

	if (!("path" in globalThis)) {
		(globalThis as any).path = {
			resolve: (...pathSegments: string[]) => {
				return pathSegments.join("/");
			}
		};
	}

	if (!globalThis.crypto) {
		throw new Error("globalThis.crypto is not available, polyfill required (crypto.getRandomValues only)");
	}

	if (!globalThis.performance) {
		throw new Error("globalThis.performance is not available, polyfill required (performance.now only)");
	}

	if (!globalThis.TextEncoder) {
		throw new Error("globalThis.TextEncoder is not available, polyfill required");
	}

	if (!globalThis.TextDecoder) {
		throw new Error("globalThis.TextDecoder is not available, polyfill required");
	}

	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	globalThis.Go = class implements GoRuntime {
		argv: string[] = ["js"];
		env: Record<string, string> = {};
		exit: (code: number) => void = (code: number) => {
			if (code !== 0) {
				console.warn("exit code:", code);
			}
		};
		_exitPromise!: Promise<void>;
		_resolveExitPromise!: () => void;
		_pendingEvent: any = null;
		_scheduledTimeouts: Map<number, any> = new Map();
		_nextCallbackTimeoutID: number = 1;
		mem!: DataView;
		_inst?: any;
		_values?: any[];
		_goRefCounts?: number[];
		_ids?: Map<number | null, number>;
		_idPool?: number[];
		exited?: boolean;
		importObject: any;
		constructor() {
			this._exitPromise = new Promise((resolve) => {
				this._resolveExitPromise = resolve;
			});
			this._pendingEvent = null;
			this._scheduledTimeouts = new Map();
			this._nextCallbackTimeoutID = 1;

			const setInt64 = (addr: number, v: number) => {
				this.mem.setUint32(addr + 0, v, true);
				this.mem.setUint32(addr + 4, Math.floor(v / 4294967296), true);
			}

			const setInt32 = (addr: number, v: number) => {
				this.mem.setUint32(addr + 0, v, true);
			}

			const getInt64 = (addr: number) => {
				const low = this.mem.getUint32(addr + 0, true);
				const high = this.mem.getInt32(addr + 4, true);
				return low + high * 4294967296;
			}

			const loadValue = (addr: number) => {
				const f = this.mem.getFloat64(addr, true);
				if (f === 0) {
					return undefined;
				}
				if (!isNaN(f)) {
					return f;
				}

				const id = this.mem.getUint32(addr, true);
				return this._values![id];
			}

			const storeValue = (addr: number, v: any) => {
				const nanHead = 0x7FF80000;

				if (typeof v === "number" && v !== 0) {
					if (isNaN(v)) {
						this.mem.setUint32(addr + 4, nanHead, true);
						this.mem.setUint32(addr, 0, true);
						return;
					}
					this.mem.setFloat64(addr, v, true);
					return;
				}

				if (v === undefined) {
					this.mem.setFloat64(addr, 0, true);
					return;
				}

				let id = this._ids!.get(v);
				if (id === undefined) {
					id = this._idPool!.pop();
					if (id === undefined) {
						id = this._values!.length;
					}
					this._values![id] = v;
					this._goRefCounts![id] = 0;
					this._ids!.set(v, id);
				}
				this._goRefCounts![id]++;
				let typeFlag = 0;
				switch (typeof v) {
					case "object":
						if (v !== null) {
							typeFlag = 1;
						}
						break;
					case "string":
						typeFlag = 2;
						break;
					case "symbol":
						typeFlag = 3;
						break;
					case "function":
						typeFlag = 4;
						break;
				}
				this.mem.setUint32(addr + 4, nanHead | typeFlag, true);
				this.mem.setUint32(addr, id, true);
			}

			const loadSlice = (addr: number) => {
				const array = getInt64(addr + 0);
				const len = getInt64(addr + 8);
				return new Uint8Array(this._inst!.exports.mem.buffer, array, len);
			}

			const loadSliceOfValues = (addr: number) => {
				const array = getInt64(addr + 0);
				const len = getInt64(addr + 8);
				const a = new Array(len);
				for (let i = 0; i < len; i++) {
					a[i] = loadValue(array + i * 8);
				}
				return a;
			}

			const loadString = (addr: number) => {
				const saddr = getInt64(addr + 0);
				const len = getInt64(addr + 8);
				return decoder.decode(new DataView(this._inst!.exports.mem.buffer, saddr, len));
			}

			const testCallExport = (a: any, b: any) => {
				this._inst!.exports.testExport0();
				return this._inst!.exports.testExport(a, b);
			}

			const timeOrigin = Date.now() - performance.now();
			this.importObject = {
				_gotest: {
					add: (a: number, b: number) => a + b,
					callExport: testCallExport,
				},
				gojs: {
					// Go's SP does not change as long as no Go code is running. Some operations (e.g. calls, getters and setters)
					// may synchronously trigger a Go event handler. This makes Go code get executed in the middle of the imported
					// function. A goroutine can switch to a new stack if the current stack is too small (see morestack function).
					// This changes the SP, thus we have to update the SP used by the imported function.

					// func wasmExit(code int32)
					"runtime.wasmExit": (sp: number) => {
						sp >>>= 0;
						const code = this.mem.getInt32(sp + 8, true);
						this.exited = true;
						delete this._inst;
						delete this._values;
						delete this._goRefCounts;
						delete this._ids;
						delete this._idPool;
						this.exit(code);
					},

					// func wasmWrite(fd uintptr, p unsafe.Pointer, n int32)
					"runtime.wasmWrite": (sp: number) => {
						sp >>>= 0;
						const fd = getInt64(sp + 8);
						const p = getInt64(sp + 16);
						const n = this.mem.getInt32(sp + 24, true);
						fs.writeSync(fd, new Uint8Array(this._inst!.exports.mem.buffer, p, n));
					},

					// func resetMemoryDataView()
					"runtime.resetMemoryDataView": (sp: number) => {
						sp >>>= 0;
						this.mem = new DataView(this._inst!.exports.mem.buffer);
					},

					// func nanotime1() int64
					"runtime.nanotime1": (sp: number) => {
						sp >>>= 0;
						setInt64(sp + 8, (timeOrigin + performance.now()) * 1000000);
					},

					// func walltime() (sec int64, nsec int32)
					"runtime.walltime": (sp: number) => {
						sp >>>= 0;
						const msec = (new Date).getTime();
						setInt64(sp + 8, msec / 1000);
						this.mem.setInt32(sp + 16, (msec % 1000) * 1000000, true);
					},

					// func scheduleTimeoutEvent(delay int64) int32
					"runtime.scheduleTimeoutEvent": (sp: number) => {
						sp >>>= 0;
						const id = this._nextCallbackTimeoutID;
						this._nextCallbackTimeoutID++;
						this._scheduledTimeouts.set(id, setTimeout(
							() => {
								this._resume();
								while (this._scheduledTimeouts.has(id)) {
									// for some reason Go failed to register the timeout event, log and try again
									// (temporary workaround for https://github.com/golang/go/issues/28975)
									console.warn("scheduleTimeoutEvent: missed timeout event");
									this._resume();
								}
							},
							getInt64(sp + 8),
						));
						this.mem.setInt32(sp + 16, id, true);
					},

					// func clearTimeoutEvent(id int32)
					"runtime.clearTimeoutEvent": (sp: number) => {
						sp >>>= 0;
						const id = this.mem.getInt32(sp + 8, true);
						clearTimeout(this._scheduledTimeouts.get(id));
						this._scheduledTimeouts.delete(id);
					},

					// func getRandomData(r []byte)
					"runtime.getRandomData": (sp: number) => {
						sp >>>= 0;
						crypto.getRandomValues(loadSlice(sp + 8));
					},

					// func finalizeRef(v ref)
					"syscall/js.finalizeRef": (sp: number) => {
						sp >>>= 0;
						const id = this.mem.getUint32(sp + 8, true);
						this._goRefCounts![id]--;
						if (this._goRefCounts![id] === 0) {
							const v = this._values![id];
							this._values![id] = null;
							this._ids!.delete(v);
							this._idPool!.push(id);
						}
					},

					// func stringVal(value string) ref
					"syscall/js.stringVal": (sp: number) => {
						sp >>>= 0;
						storeValue(sp + 24, loadString(sp + 8));
					},

					// func valueGet(v ref, p string) ref
					"syscall/js.valueGet": (sp: number) => {
						sp >>>= 0;
						const result = Reflect.get(loadValue(sp + 8), loadString(sp + 16));
						sp = this._inst!.exports.getsp() >>> 0; // see comment above
						storeValue(sp + 32, result);
					},

					// func valueSet(v ref, p string, x ref)
					"syscall/js.valueSet": (sp: number) => {
						sp >>>= 0;
						Reflect.set(loadValue(sp + 8), loadString(sp + 16), loadValue(sp + 32));
					},

					// func valueDelete(v ref, p string)
					"syscall/js.valueDelete": (sp: number) => {
						sp >>>= 0;
						Reflect.deleteProperty(loadValue(sp + 8), loadString(sp + 16));
					},

					// func valueIndex(v ref, i int) ref
					"syscall/js.valueIndex": (sp: number) => {
						sp >>>= 0;
						storeValue(sp + 24, Reflect.get(loadValue(sp + 8), getInt64(sp + 16)));
					},

					// valueSetIndex(v ref, i int, x ref)
					"syscall/js.valueSetIndex": (sp: number) => {
						sp >>>= 0;
						Reflect.set(loadValue(sp + 8), getInt64(sp + 16), loadValue(sp + 24));
					},

					// func valueCall(v ref, m string, args []ref) (ref, bool)
					"syscall/js.valueCall": (sp: number) => {
						sp >>>= 0;
						try {
							const v = loadValue(sp + 8);
							const m = Reflect.get(v, loadString(sp + 16));
							const args = loadSliceOfValues(sp + 32);
							const result = Reflect.apply(m, v, args);
							sp = this._inst!.exports.getsp() >>> 0; // see comment above
							storeValue(sp + 56, result);
							this.mem.setUint8(sp + 64, 1);
						} catch (err) {
							sp = this._inst!.exports.getsp() >>> 0; // see comment above
							storeValue(sp + 56, err);
							this.mem.setUint8(sp + 64, 0);
						}
					},

					// func valueInvoke(v ref, args []ref) (ref, bool)
					"syscall/js.valueInvoke": (sp: number) => {
						sp >>>= 0;
						try {
							const v = loadValue(sp + 8);
							const args = loadSliceOfValues(sp + 16);
							const result = Reflect.apply(v, undefined, args);
							sp = this._inst!.exports.getsp() >>> 0; // see comment above
							storeValue(sp + 40, result);
							this.mem.setUint8(sp + 48, 1);
						} catch (err) {
							sp = this._inst!.exports.getsp() >>> 0; // see comment above
							storeValue(sp + 40, err);
							this.mem.setUint8(sp + 48, 0);
						}
					},

					// func valueNew(v ref, args []ref) (ref, bool)
					"syscall/js.valueNew": (sp: number) => {
						sp >>>= 0;
						try {
							const v = loadValue(sp + 8);
							const args = loadSliceOfValues(sp + 16);
							const result = Reflect.construct(v, args);
							sp = this._inst!.exports.getsp() >>> 0; // see comment above
							storeValue(sp + 40, result);
							this.mem.setUint8(sp + 48, 1);
						} catch (err) {
							sp = this._inst!.exports.getsp() >>> 0; // see comment above
							storeValue(sp + 40, err);
							this.mem.setUint8(sp + 48, 0);
						}
					},

					// func valueLength(v ref) int
					"syscall/js.valueLength": (sp: number) => {
						sp >>>= 0;
						setInt64(sp + 16, parseInt(loadValue(sp + 8).length));
					},

					// valuePrepareString(v ref) (ref, int)
					"syscall/js.valuePrepareString": (sp: number) => {
						sp >>>= 0;
						const str = encoder.encode(String(loadValue(sp + 8)));
						storeValue(sp + 16, str);
						setInt64(sp + 24, str.length);
					},

					// valueLoadString(v ref, b []byte)
					"syscall/js.valueLoadString": (sp: number) => {
						sp >>>= 0;
						const str = loadValue(sp + 8);
						loadSlice(sp + 16).set(str);
					},

					// func valueInstanceOf(v ref, t ref) bool
					"syscall/js.valueInstanceOf": (sp: number) => {
						sp >>>= 0;
						this.mem.setUint8(sp + 24, (loadValue(sp + 8) instanceof loadValue(sp + 16)) ? 1 : 0);
					},

					// func copyBytesToGo(dst []byte, src ref) (int, bool)
					"syscall/js.copyBytesToGo": (sp: number) => {
						sp >>>= 0;
						const dst = loadSlice(sp + 8);
						const src = loadValue(sp + 32);
						if (!(src instanceof Uint8Array || src instanceof Uint8ClampedArray)) {
							this.mem.setUint8(sp + 48, 0);
							return;
						}
						const toCopy = src.subarray(0, dst.length);
						dst.set(toCopy);
						setInt64(sp + 40, toCopy.length);
						this.mem.setUint8(sp + 48, 1);
					},

					// func copyBytesToJS(dst ref, src []byte) (int, bool)
					"syscall/js.copyBytesToJS": (sp: number) => {
						sp >>>= 0;
						const dst = loadValue(sp + 8);
						const src = loadSlice(sp + 16);
						if (!(dst instanceof Uint8Array || dst instanceof Uint8ClampedArray)) {
							this.mem.setUint8(sp + 48, 0);
							return;
						}
						const toCopy = src.subarray(0, dst.length);
						dst.set(toCopy);
						setInt64(sp + 40, toCopy.length);
						this.mem.setUint8(sp + 48, 1);
					},

					"debug": (value: any) => {
						console.log(value);
					},
				}
			};
		}

		async run(instance: WebAssembly.Instance) {
			if (!(instance instanceof WebAssembly.Instance)) {
				throw new Error("Go.run: WebAssembly.Instance expected");
			}
			this._inst = instance;
			this.mem = new DataView(this._inst!.exports.mem.buffer);
			this._values = [ // JS values that Go currently has references to, indexed by reference id
				NaN,
				0,
				null,
				true,
				false,
				globalThis,
				this,
			];
			this._goRefCounts = new Array(this._values.length).fill(Infinity); // number of references that Go has to a JS value, indexed by reference id
			this._ids = new Map<number | null, number>([
				[0, 1],
				[null, 2],
			]);
			this._idPool = [];   // unused ids that have been garbage collected
			this.exited = false; // whether the Go program has exited

			// Pass command line arguments and environment variables to WebAssembly by writing them to the linear memory.
			let offset = 4096;

			const strPtr = (str: string) => {
				const ptr = offset;
				const bytes = encoder.encode(str + "\0");
				new Uint8Array(this.mem.buffer, offset, bytes.length).set(bytes);
				offset += bytes.length;
				if (offset % 8 !== 0) {
					offset += 8 - (offset % 8);
				}
				return ptr;
			};

			const argc = this.argv.length;

			const argvPtrs = [];
			this.argv.forEach((arg) => {
				argvPtrs.push(strPtr(arg));
			});
			argvPtrs.push(0);

			const keys = Object.keys(this.env).sort();
			keys.forEach((key) => {
				argvPtrs.push(strPtr(`${key}=${this.env[key]}`));
			});
			argvPtrs.push(0);

			const argv = offset;
			argvPtrs.forEach((ptr) => {
				this.mem.setUint32(offset, ptr, true);
				this.mem.setUint32(offset + 4, 0, true);
				offset += 8;
			});

			// The linker guarantees global data starts from at least wasmMinDataAddr.
			// Keep in sync with cmd/link/internal/ld/data.go:wasmMinDataAddr.
			const wasmMinDataAddr = 4096 + 8192;
			if (offset >= wasmMinDataAddr) {
				throw new Error("total length of command line and environment variables exceeds limit");
			}

			this._inst!.exports.run(argc, argv);
			if (this.exited) {
				this._resolveExitPromise();
			}
			await this._exitPromise;
		}

		_resume() {
			if (this.exited) {
				throw new Error("Go program has already exited");
			}
			this._inst!.exports.resume();
			if (this.exited) {
				this._resolveExitPromise();
			}
		}

		_makeFuncWrapper(id: number) {
			const go = this;
			return function (this: any, ...args: any[]) {
				const event: { id: number; thisArg: any; args: IArguments; result?: any } = { id: id, thisArg: this, args: arguments };
				go._pendingEvent = event;
				go._resume();
				return event.result;
			};
		}
	}
}

function resolveWasmFile(filename: string) {
  // Try to resolve from a known static path (e.g., inside your SDK or project root)
  const possiblePaths = [
    path.join(__dirname, filename), // e.g., SDK's own directory
    path.join(__dirname, 'webassembly', filename), // e.g., SDK/webassembly/
    path.join(process.cwd(), 'webassembly', filename), // project root/webassembly/
    path.join(process.cwd(), 'node_modules', 'dist/webassembly', filename), // node_modules/dist/webassembly/
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log(`[mlkem-node] Resolved ${filename} at:`, p);
      return p;
    }
  }

  console.error(`[mlkem-node] Cannot resolve wasm file: ${filename}`);
  throw new Error(`Cannot resolve wasm file: ${filename}`);
}


// --- Polyfill for Web Crypto API ---
declare global {
  var Go: any;
  var mlkemKeyGen: () => any;
  var mlkemEncrypt: (pubKey: string, message: string) => any;
  var mlkemDecrypt: (privKey: string, encryptedData: string, version: string) => any;
  var symEncrypt: (ssKey: string, message: string) => any;
  var symDecrypt: (ssKey: string, encryptedData: string, version: string) => any;
  var privateKeyToWalletAddress: (pk: string) => any;
  var signTransactionMLDSA87: (TxObject: any, privateKeyHex: string) => any;
  var decodeRLPTransaction: (txHex: string) => any;
  var fs: typeof import('fs');
  interface Crypto {
    getRandomValues(array: Uint8Array): void;
  }
}

if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {} as Crypto;
}
if (typeof globalThis.crypto.getRandomValues === 'undefined') {
  globalThis.crypto.getRandomValues = webcrypto.getRandomValues.bind(webcrypto);
}
// --- End Polyfill ---

global.fs = fs;
// Load the Go WebAssembly support code
// nodeRequire(wasmExecPath);

createGoRuntime();

/**
 * Public interface for MLKEM operations in Node.js
 */
export interface MlKemNode {
  /**
   * Generate a new keypair.
   * Resolves to an object: { pubKey: base64-string; privKey: base64-string }.
   */
  keyGen(): Promise<{ pubKey: string; privKey: string }>;

  /**
   * Asymmetric encrypt with the given public key.
   */
  encrypt(
    pubKey: string,
    message: string
  ): Promise<{ encryptedData: string; version: string }>;

  /**
   * Asymmetric decrypt with the given private key.
   */
  decrypt(
    privKey: string,
    encryptedData: string,
    version: string
  ): Promise<string>;

  /**
   * Symmetric encrypt with the shared-secret key.
   */
  symEncrypt(
    ssKey: string,
    message: string
  ): Promise<{ encryptedData: string; version: string }>;

  /**
   * Symmetric decrypt with the shared-secret key.
   */
  symDecrypt(
    ssKey: string,
    encryptedData: string,
    version: string
  ): Promise<string>;

  /**
   * Derive an EVM-style address (hex) from a raw private-key string.
   */
  privateKeyToAddress(privateKey: string): string;

  /**
   * Sign a transaction object with the given private key.
   */
  signTransactionMLDSA87: (TxObject: any, privateKeyHex: string) => any;

  decodeRLPTransaction: (txHex: string) => any;

}

/**
 * Load and initialize the MLKEM Go WebAssembly module.
 */
export async function loadWasm(): Promise<MlKemNode> {
  const wasmPath = resolveWasmFile('main.wasm');
  const wasmBuffer = fs.readFileSync(wasmPath);

  const go = new Go();
  const importObject = go.importObject;
  const { instance } = await WebAssembly.instantiate(wasmBuffer, importObject);

  try {
    go.run(instance);
  } catch (err) {
    console.error('Error starting go.run(instance):', err);
    throw err;
  }

  // Give Go time to register its JS functions
  await new Promise((resolve) => setTimeout(resolve, 50));

  return {
    keyGen: async (): Promise<{ pubKey: string; privKey: string }> => {
      if (typeof globalThis.mlkemKeyGen !== 'function') {
        console.error(
          'Available globalThis keys:',
          Object.keys(globalThis).slice(0, 20)
        );
        throw new Error('mlkemKeyGen not found on globalThis');
      }
      const result = globalThis.mlkemKeyGen();
      if (result?.error) throw new Error(`Go keyGen failed: ${result.error}`);
      if (!result?.pubKey || !result?.privKey) {
        console.error('Unexpected keyGen result:', result);
        throw new Error('Invalid result from mlkemKeyGen');
      }
      return { pubKey: result.pubKey, privKey: result.privKey };
    },

    encrypt: async (pubKey, message) => {
      if (typeof globalThis.mlkemEncrypt !== 'function') {
        throw new Error('mlkemEncrypt not found on globalThis');
      }
      const result = globalThis.mlkemEncrypt(pubKey, message);
      if (result?.error) throw new Error(`Go encrypt failed: ${result.error}`);
      if (!result?.encrypted || !result?.version) {
        console.error('Unexpected encrypt result:', result);
        throw new Error('Invalid result from mlkemEncrypt');
      }
      return { encryptedData: result.encrypted, version: result.version };
    },

    decrypt: async (privKey, encryptedData, version) => {
      if (typeof globalThis.mlkemDecrypt !== 'function') {
        throw new Error('mlkemDecrypt not found on globalThis');
      }
      const result = globalThis.mlkemDecrypt(privKey, encryptedData, version);
      if (result?.error) throw new Error(`Go decrypt failed: ${result.error}`);
      if (typeof result.decrypted !== 'string') {
        console.error('Unexpected decrypt result:', result);
        throw new Error('Invalid result from mlkemDecrypt');
      }
      return result.decrypted;
    },

    symEncrypt: async (ssKey, message) => {
      if (typeof globalThis.symEncrypt !== 'function') {
        throw new Error('symEncrypt not found on globalThis');
      }
      const result = globalThis.symEncrypt(ssKey, message);
      if (result?.error) throw new Error(`Go symEncrypt failed: ${result.error}`);
      if (!result?.encrypted || !result?.version) {
        console.error('Unexpected symEncrypt result:', result);
        throw new Error('Invalid result from symEncrypt');
      }
      return { encryptedData: result.encrypted, version: result.version };
    },

    symDecrypt: async (ssKey, encryptedData, version) => {
      if (typeof globalThis.symDecrypt !== 'function') {
        throw new Error('symDecrypt not found on globalThis');
      }
      const result = globalThis.symDecrypt(ssKey, encryptedData, version);
      if (result?.error) throw new Error(`Go symDecrypt failed: ${result.error}`);
      if (typeof result.decrypted !== 'string') {
        console.error('Unexpected symDecrypt result:', result);
        throw new Error('Invalid result from symDecrypt');
      }
      return result.decrypted;
    },

    privateKeyToAddress: (privateKey: string): string => {
      if (typeof globalThis.privateKeyToWalletAddress !== 'function') {
        throw new Error('privateKeyToWalletAddress not found on globalThis');
      }
      const result = globalThis.privateKeyToWalletAddress(privateKey);
      if (result?.error) throw new Error(`Go privateKeyToAddress failed: ${result.error}`);
      if (typeof result?.address !== 'string') {
        console.error('Unexpected address result:', result);
        throw new Error('Invalid result from privateKeyToWalletAddress');
      }
      return result.address;
    },

    signTransactionMLDSA87:(TxObject : any, privateKeyHex : string) => {
      if (typeof globalThis.signTransactionMLDSA87 !== 'function') {
        throw new Error('signTransactionMLDSA87 not found on globalThis');
      }
      const result = globalThis.signTransactionMLDSA87(TxObject, privateKeyHex );
      if (result?.error) throw new Error(`Go signTransactionMLDSA87 failed: ${result.error}`);
      if (typeof result !== 'object') {
        console.error('Unexpected result:', result);
        throw new Error('Invalid result from signTransactionMLDSA87');
      }
      return result;
    },

    decodeRLPTransaction: (KeyHex: string) => {
      if (typeof globalThis.decodeRLPTransaction !== 'function') {
        throw new Error('decodeRLPTransaction not found on globalThis');
      }
      const result = globalThis.decodeRLPTransaction(KeyHex);
      if (result?.error) throw new Error(`Go decodeRLPTransaction failed: ${result.error}`);
      if (typeof result !== 'object') {
        console.error('Unexpected result:', result);
        throw new Error('Invalid result from decodeRLPTransaction');
      }
      return result;
    }

  };
}
