// @name: Everest Channel
// @version: 1.0
// @recent_changes: Changed Logic to be modular

import { Service, Inject } from 'typedi';
import config from '../../config';
import showrunnersHelper from '../../helpers/showrunnersHelper';
// import PQueue from 'p-queue';
import { ethers, logger } from 'ethers';
import epnsHelper, {InfuraSettings, NetWorkSettings, EPNSSettings} from '@epnsproject/backend-sdk'
// const queue = new PQueue();

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
const everestSettings = require('./everestSettings.json')
const everestDeployedContractABI = require('./everest.json')
const NETWORK_TO_MONITOR = config.web3MainnetNetwork

// SET CONSTANTS
const BLOCK_NUMBER = 'block_number';

@Service()
export default class EverestChannel {
  constructor(
    @Inject('cached') private cached,
    @Inject('logger') private logger,
  ) {
      //initializing cache
      this.cached.setCache(BLOCK_NUMBER, 0);
  }
  public async getWalletKey() {
    var path = require('path');
    const dirname = path.basename(__dirname);
    const wallets = config.showrunnerWallets[`${dirname}`];
    const currentWalletInfo = await showrunnersHelper.getValidWallet(dirname, wallets);
    const walletKeyID = `wallet${currentWalletInfo.currentWalletID}`;
    const walletKey = wallets[walletKeyID];
    return walletKey;
  }
 
  // To form and write to smart contract
  public async sendMessageToContract(simulate) {
    const logger = this.logger;
    const cache = this.cached;
    const walletKey = await this.getWalletKey()
    const sdk = new epnsHelper(NETWORK_TO_MONITOR, walletKey, settings, epnsSettings);

    logger.debug(`[${new Date(Date.now())}]-[Everest]- Checking for challenged projects addresses...`);

    // Overide logic if need be
    const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") && simulate.logicOverride.mode ? simulate.logicOverride.mode : false) : false;
    const epnsNetwork = logicOverride && simulate.logicOverride.hasOwnProperty("epnsNetwork") ? simulate.logicOverride.epnsNetwork : config.web3RopstenNetwork;
    const everestNetwork = logicOverride && simulate.logicOverride.hasOwnProperty("everestNetwork") ? simulate.logicOverride.everestNetwork : config.web3MainnetNetwork;
    // -- End Override logic

    const everest = await sdk.getContract(everestSettings.everestDeployedContract, everestDeployedContractABI)

    // Initialize block if that is missing
    let cachedBlock = await cache.getCache(BLOCK_NUMBER);
    if (!cachedBlock) {
      cachedBlock = 0;
      logger.debug(`[${new Date(Date.now())}]-[Everest]- Initialized flag was not set, first time initalzing, saving latest block of blockchain where everest contract is...`);
      everest.provider.getBlockNumber().then((blockNumber) => {
        logger.debug(`[${new Date(Date.now())}]-[Everest]- Current block number is... %s`, blockNumber);
        cache.setCache(BLOCK_NUMBER, blockNumber);
        logger.info(`[${new Date(Date.now())}]-[Everest]- Initialized Block Number: %s`, blockNumber);
      })
      .catch(err => {
        logger.debug(`[${new Date(Date.now())}]-[Everest]- Error occurred while getting Block Number: %o`, err);
      })
    }

    // Overide logic if need be
    const fromBlock = logicOverride && simulate.logicOverride.hasOwnProperty("fromBlock") ? Number(simulate.logicOverride.fromBlock) : Number(cachedBlock);
    const toBlock = logicOverride && simulate.logicOverride.hasOwnProperty("toBlock") ? Number(simulate.logicOverride.toBlock) : "latest";
    // -- End Override logic

    // Check Member Challenge Event
    this.checkMemberChallengedEvent(everestNetwork, everest, fromBlock, toBlock, sdk, simulate)
    .then(async(info: any) => {
      // First save the block number
      cache.setCache(BLOCK_NUMBER, info.lastBlock);

      // Check if there are events else return
      if (info.eventCount == 0) {
        logger.info(`[${new Date(Date.now())}]-[Everest]- No New Challenges Made...`);
      }
      // Otherwise process those challenges
      for(let i = 0; i < info.eventCount; i++) {
        let user = info.log[i].args.member
        const title = 'Challenge made';
        const message = `A challenge has been made on your Everest Project`;
        const payloadTitle = 'Challenge made';
        const payloadMsg = `A challenge has been made on your Everest Project`;
        const notificationType = 3;
        const tx = await sdk.sendNotification(user, title, message, payloadTitle, payloadMsg, notificationType, simulate)
        logger.info(`[${new Date(Date.now())}]-[Everest]- 🔥Tx --> : %o`, tx);
      }
    })
    .catch(err => {
      logger.debug(`[${new Date(Date.now())}]-[Everest]- 🔥Error --> Unable to obtain challenged members event: %o`, err);
    });
  }

  public async checkMemberChallengedEvent(web3network, everest, fromBlock, toBlock, sdk, simulate) {
    const logger = this.logger;
    const cache = this.cached;
    logger.debug(`[${new Date(Date.now())}]-[Everest]- Getting eventLog, eventCount, blocks...`);
    //simulate object settings START
    try{
      const logicOverride = typeof simulate == 'object' ? ((simulate.hasOwnProperty("logicOverride") && simulate.logicOverride.mode) ? simulate.logicOverride.mode : false) : false;
      const simulateFromBlock = logicOverride && simulate.logicOverride.hasOwnProperty("fromBlock") ? simulate.logicOverride.fromBlock : false;
      const simulateToBlock = logicOverride && simulate.logicOverride.hasOwnProperty("toBlock") ? simulate.logicOverride.toBlock : false;
      if(!sdk){
        const walletKey = await this.getWalletKey()
        sdk = new epnsHelper(NETWORK_TO_MONITOR, walletKey, settings, epnsSettings);
      }
      // Check if everest is initialized, if not initialize it
      if (!everest) {
      // check and recreate provider mostly for routes
      logger.info(`[${new Date(Date.now())}]-[Everest]- Mostly coming from routes... rebuilding interactable erc20s`);
      everest = await sdk.getContract(everestSettings.everestDeployedContract, everestDeployedContractABI)
      logger.info(`[${new Date(Date.now())}]-[Everest]- Rebuilt everest --> %o`, everest);
      }
      if(!fromBlock){
        if(simulateFromBlock){
          logger.info(`[${new Date(Date.now())}]-[Everest]- Mostly coming from routes... resetting fromBlock to ${simulateFromBlock}`);
          fromBlock = simulateFromBlock
        }
        else{
          logger.debug(`[${new Date(Date.now())}]-[Everest]- fromBlock is not defined`)
        }
      }
      if(!toBlock){
        if(simulateToBlock){
          logger.info(`[${new Date(Date.now())}]-[Everest]- Mostly coming from routes... resetting toBlock to ${simulateToBlock}`);
          toBlock = simulateToBlock
        }
        else{
          logger.info(`[${new Date(Date.now())}]-[Everest]- Mostly coming from routes... resetting toBlock to latest`);
          toBlock = "latest";
        }
      }
    }
    catch(err){
      logger.error(`[${new Date(Date.now())}]-[Everest]- error: ${err}`)
    }
    //simulate object settings END

    return await new Promise(async(resolve, reject) => {
      const filter = everest.contract.filters.MemberChallenged();
      logger.debug(`[${new Date(Date.now())}]-[Everest]- Looking for MemberChallenged() from %d to %s`, fromBlock, toBlock);

      everest.contract.queryFilter(filter, fromBlock, toBlock)
        .then(async (eventLog) => {
          logger.debug(`[${new Date(Date.now())}]-[Everest]- MemberChallenged() --> %o`, eventLog);

          // Need to fetch latest block
          try {
            toBlock = await everest.provider.getBlockNumber();
            logger.debug(`[${new Date(Date.now())}]-[Everest]- Latest block updated to --> %s`, toBlock);
          }
          catch (err) {
            logger.debug(`[${new Date(Date.now())}]-[Everest]- !Errored out while fetching Block Number --> %o`, err);
          }
          const info = {
            change: true,
            log: eventLog,
            blockChecker: fromBlock,
            lastBlock: toBlock,
            eventCount: eventLog.length
          }
          resolve(info);

          logger.debug(`[${new Date(Date.now())}]-[Everest]- Events retreived for MemberChallenged() call of Everest Contract --> %d Events`, eventLog.length);
        })
        .catch (err => {
          logger.debug(`[${new Date(Date.now())}]-[Everest]- Unable to obtain query filter, error: %o`, err)
          resolve({
            success: false,
            err: "Unable to obtain query filter, error: %o" + err
          });
        });
    })
  }
}

