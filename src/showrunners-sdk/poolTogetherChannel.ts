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

const NETWORK_TO_MONITOR = config.web3MainnetNetwork;

const sdk = new epnsHelper(NETWORK_TO_MONITOR, channelKey, settings, epnsSettings)

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
    const cache = this.cached;

    logger.debug(`[${new Date(Date.now())}]-[Pool Together]- Checking for new awardees...`);

    // Overide logic of need be
    const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") && simulate.logicOverride.mode ? simulate.logicOverride.mode : false) : false;

    const epnsNetwork = logicOverride && simulate.logicOverride.hasOwnProperty("epnsNetwork") ? simulate.logicOverride.epnsNetwork : config.web3RopstenNetwork;
    const poolTogetherNetwork = logicOverride && simulate.logicOverride.hasOwnProperty("poolNetwork") ? simulate.logicOverride.yamNetwork : config.web3KovanNetwork;
    // -- End Override logic
    
    // Initialize block if that is missing
    let cachedBlock = await cache.getCache(BLOCK_NUMBER);
    console.log("[Pool Together] CACHED BLOCK", cachedBlock);
    if (!cachedBlock) {
      cachedBlock = 0;
      logger.debug(`[${new Date(Date.now())}]-[Pool Together]- Initialized flag was not set, first time initalzing, saving latest block of blockchain where poolTogether contract is...`);
      const provider = ethers.getDefaultProvider(NETWORK_TO_MONITOR);
      let blockNumber = await provider.getBlockNumber();
      
      logger.debug(`[${new Date(Date.now())}]-[Pool Together]- Current block number is... %s`, blockNumber);
      cache.setCache(BLOCK_NUMBER, blockNumber);
      logger.info("Initialized Block Number: %s", blockNumber);
    }

    // Overide logic if need be
    const fromBlock = logicOverride && simulate.logicOverride.hasOwnProperty("fromBlock") ? Number(simulate.logicOverride.fromBlock): Number(cachedBlock);
    const toBlock = logicOverride && simulate.logicOverride.hasOwnProperty("toBlock") ? Number(simulate.logicOverride.toBlock) : "latest";
    // -- End Override logic
    console.log("poolTogether send_notification fromblock", fromBlock);

    // Array of poolTogether pool contract addresses
    const poolContracts = [];
    
    for (let i = 0; i < poolContracts.length; i++) {
      let poolTogether = await sdk.getContract(poolContracts[i], config.poolTogetherDeployedContractABI);

      this.getWinners(NETWORK_TO_MONITOR, poolTogether, fromBlock, toBlock, simulate)
      .then(async(info: any) => {
        // First save the block number
        cache.setCache(BLOCK_NUMBER, info.lastBlock);

        //Check if there are events else return
        if (info.eventCount == 0) {
          logger.info("No new Winner...");
        }

        // Otherwise process those winners
        for(let i = 0; i < info.eventCount; i++) {
          console.log(info.log[i]);
          let winner = info.log[i].args.winner;
          let amount = info.log[i].args.amount;

          let title = "You Have WOOOONNNN!!🎊🎊";
          let body = "You have won " + amount + "from poolTogether. Wen PARTY??";
          let payloadTitle = "You Have WOOOONNNN!!🎊🎊";
          let payloadBody = "You have won " + amount + "from poolTogether. Wen PARTY??";
          const notificationType = 3;
          //const tx = await sdk.sendNotification(winner, title, body, payloadTitle, payloadBody, notificationType, simulate);
          //logger.info(tx);
          logger.info(body);
        }
      })
      .catch(err => {
        logger.debug(`[${new Date(Date.now())}]-[Pool Together]- 🔥Error --> Unable to obtain new winner's event: %o`, err);
      })
    }
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