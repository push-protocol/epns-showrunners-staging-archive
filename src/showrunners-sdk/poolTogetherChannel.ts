// @name: poolTogether Channel
// @version: 1.0

import { Service, Inject } from 'typedi';
import config from '../config';
import channelWalletsInfo from '../config/channelWalletsInfo';
// import PQueue from 'p-queue';
import { ethers, logger } from 'ethers';
import epnsHelper, {InfuraSettings, NetWorkSettings, EPNSSettings} from '@epnsproject/backend-sdk-staging'
// const queue = new PQueue();
const channelKey = channelWalletsInfo.walletsKV['pooltogetherPrivateKey_1'];

const infuraSettings: InfuraSettings = {
  projectID: config.infuraAPI.projectID,
  projectSecret: config.infuraAPI.projectSecret
}
const settings: NetWorkSettings = {
  alchemy: config.alchemyAPI,
  infura: infuraSettings,
  etherscan: config.etherscanAPI
}
const epnsSettings: EPNSSettings = {
  network: config.web3RopstenNetwork,
  contractAddress: config.deployedContract,
  contractABI: config.deployedContractABI
}
const sdk = new epnsHelper(config.web3MainnetNetwork, channelKey, settings, epnsSettings)

// SET CONSTANTS
const BLOCK_NUMBER = 'block_number';

@Service()
export default class PoolTogetherChannel {
  constructor(
    @Inject('cached') private cached,
) {
    //initializing cache
    this.cached.setCache(BLOCK_NUMBER, 0);
}

  public async sendMessageToContract(simulate) {
    
  }

  public async getWinners(web3network, poolTogether, fromBlock, toBlock, simulate) {
    
  }
}