import { Service, Inject, Container } from 'typedi';
import config from '../config';

import { EventDispatcher, EventDispatcherInterface } from '../decorators/eventDispatcher';
import EmailService from './emailService';
import { BigNumber, ethers, logger, Wallet } from 'ethers';

const NETWORK_TO_MONITOR = config.web3MainnetNetwork;
const provider = ethers.getDefaultProvider(NETWORK_TO_MONITOR, {
      etherscan: (config.etherscanAPI ? config.etherscanAPI : null),
      infura: (config.infuraAPI ? {projectId: config.infuraAPI.projectID, projectSecret: config.infuraAPI.projectSecret} : null),
      alchemy: (config.alchemyAPI ? config.alchemyAPI : null),
});
const pushABI = require('../config/push.json')
const pushAddress = "0xf418588522d5dd018b425E472991E52EBBeEEEEE"



const MAIN = new Wallet(config.masterWallet, provider)

@Service()
export default class WalletTrackerChannel {
  constructor(
    @Inject('logger') private logger,
    @Inject('cached') private cached,
    @EventDispatcher() private eventDispatcher: EventDispatcherInterface,
  ) {
  }

  public async getDelegatorInfo() {
    const cache = this.cached;
    const logger = this.logger;

    const pushToken = new ethers.Contract(pushAddress, pushABI, provider);

    const filter1 = pushToken.filters.DelegateChanged();
    const filter2 = pushToken.filters.DelegateVotesChanged();

    pushToken.queryFilter(filter1)
      .then(async (eventLog) => {

          // Need to fetch latest block
          try {
              // logger.debug(eventLog);
              for(let i = 0; i < eventLog.length; i++) {
                console.log(`🚀 ~ file: DelegateChanged.ts ~ line 46 ~ WalletTrackerChannel ~ .then ~ eventLog[i].args ${i}: `, eventLog[i].args)
            }
          }
          catch (err) {
              logger.error(`[${new Date(Date.now())}]-!Errored out while fetching Block Number --> %o`, err);
          }
          

          logger.debug(`[${new Date(Date.now())}]- Events retreived for DelegateChanged() Events`, eventLog.length);
      })

      pushToken.queryFilter(filter2)
      .then(async (eventLog) => {

          // Need to fetch latest block
          try {
              // logger.debug(eventLog);
              for(let i = 0; i < eventLog.length; i++) {
                console.log(`🚀 ~ file: DelegateVotesChanged.ts ~ line 46 ~ WalletTrackerChannel ~ .then ~ eventLog[i].args ${i}: `, eventLog[i].args)
            }
          }
          catch (err) {
              logger.error(`[${new Date(Date.now())}]-!Errored out while fetching Block Number --> %o`, err);
          }
          

          logger.debug(`[${new Date(Date.now())}]- Events retreived for DelegateChanged() Events`, eventLog.length);
      })

    
  }

 
}
