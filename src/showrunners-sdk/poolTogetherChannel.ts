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
    logger.debug(`[${new Date(Date.now())}]-[Pool Together]- Getting eventLog, eventCount, blocks...`);

    if (!toBlock) {
      logger.info(`[${new Date(Date.now())}]-[Pool Together]- Mostly coming from routes... resetting toBlock to latest`);
      toBlock = "latest";
    }

    const cach = this.cached;

    return await new Promise(async(resolve, reject) => {
      const filter = poolTogether.contract.filters.Awarded();
      logger.debug(`[${new Date(Date.now())}]-[Pool Together]- Looking for Awarded() from %d to %s`, fromBlock, toBlock);

      poolTogether.contract.queryFilter(filter, fromBlock, toBlock)
      .then(async (eventLog) => {
        logger.debug(`[${new Date(Date.now())}]-[Pool Together]- Awarded() --> %o`, eventLog);

        // Need to fetch latest block
        try {
          toBlock = await poolTogether.provider.getBlockNumber();
          logger.debug(`[${new Date(Date.now())}]-[Pool Together]- Latest block updated to --> %s`, toBlock);
        }
        catch (err) {
          logger.debug(`[${new Date(Date.now())}]-[Pool Together]- !Errored out while fetching Block Number --> %o`, err);
        }

        const info = {
          change: true,
          log: eventLog,
          blockChecker: fromBlock,
          lastBlock: toBlock,
          eventCount: eventLog.length
        }

        resolve(info);
        logger.debug(`[${new Date(Date.now())}]-[Pool Together]- Events retreived for Awarded() call of Yam Governance Contract --> %d Events`, eventLog.length);
      })
      .catch(err => {
        logger.debug(`[${new Date(Date.now())}]-[Pool Together]- Unable to obtain query filter, error: %o`, err);
        resolve({
          success: false,
          err: "Unable to obtain query filter, error: %o" + err
        });
      });
    });
  }
}