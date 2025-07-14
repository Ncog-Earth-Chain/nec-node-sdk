import { Contract, ISigner } from './contract';
import { Provider } from './provider';
import { Interface } from 'ethers';

export class ContractFactory {
  public readonly abi: any[];
  public readonly bytecode: string;
  public readonly provider: Provider;
  public readonly signer?: ISigner;

  constructor(abi: any[], bytecode: string, provider: Provider, signer?: ISigner) {
    this.abi = abi;
    this.bytecode = bytecode;
    this.provider = provider;
    this.signer = signer;
  }

  async deploy(constructorArgs: any[] = [], options: Record<string, any> = {}) {
    const deployer = this.signer || options.from;
    if (!deployer) throw new Error('No deployer (signer or from address) specified');

    options.nonce = options.nonce || (await this.provider.getTransactionCount(typeof deployer === 'string' ? deployer : await deployer.getAddress?.()));
    options.gasPrice = options.gasPrice || (await this.provider.getGasPrice());

    // Auto-estimate gas if not provided
    if (!options.gasLimit) {
      try {
        const iface = new Interface(this.abi);
        let deployData = this.bytecode;
        if (constructorArgs && constructorArgs.length > 0) {
          deployData += iface.encodeDeploy(constructorArgs).slice(2); // remove 0x
        }
        const estimateGasParams = {
          from: typeof deployer === 'string' ? deployer : (await deployer.getAddress?.()) || undefined,
          data: deployData,
        };
        let gasLimit = await this.provider.estimateGas(estimateGasParams);
        gasLimit = Math.floor(Number(gasLimit) * 1.2); // add 20% buffer
        options.gasLimit = gasLimit;
      } catch (err) {
        // fallback default
        options.gasLimit = 7000000;
      }
    }

    const { contractAddress, txHash, receipt } = await Contract.deploy({
      abi: this.abi,
      bytecode: this.bytecode,
      provider: this.provider,
      deployer,
      constructorArgs,
      options,
    });
    return new Contract(contractAddress, this.abi, this.provider, this.signer);
  }

  attach(address: string) {
    return new Contract(address, this.abi, this.provider, this.signer);
  }
} 