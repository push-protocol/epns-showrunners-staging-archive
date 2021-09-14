import { Inject, Service } from 'typedi';
import config from '../../config';
import showrunnersHelper from '../../helpers/showrunnersHelper';
import epnsHelper, { InfuraSettings, NetWorkSettings, EPNSSettings } from '@epnsproject/backend-sdk-staging';
import yamGovernanceSettings from './yamGovernanceSettings.json';
import yamGovernanceDeployedContractABI from './yamGovernance.json';
import epnsNotifyHelper from '../../helpers/epnsNotifyHelper';
import { toString } from 'lodash';

const infuraSettings: InfuraSettings = {
  projectID: config.infuraAPI.projectID,
  projectSecret: config.infuraAPI.projectSecret,
};

const settings: NetWorkSettings = {
  alchemy: config.alchemyAPI,
  infura: infuraSettings,
  etherscan: config.etherscanAPI,
};

const epnsSettings: EPNSSettings = {
  network: config.web3RopstenNetwork,
  contractAddress: config.deployedContract,
  contractABI: config.deployedContractABI,
};

// SET CONSTANTS
const BLOCK_NUMBER = 'block_number';

@Service()
export default class YamGovernanceChannel {
  walletKey: string;
  sdk: epnsHelper;
  initalized = false;

  constructor(@Inject('logger') private logger, @Inject('cached') private cached) {
    this.initialize();
  }

  async initialize() {
    try {
      this.walletKey = await this.getWalletKey();
      this.sdk = new epnsHelper(config.web3KovanNetwork, this.walletKey, settings, epnsSettings);
      this.initalized = true;
    } catch (err) {
      this.initalized = false;
      this.logger.debug(
        `[${new Date(Date.now())}]-[Yam Governance]- Error occurred while Initalizing wallet keys and  sdk: %o`,
        err,
      );
    }
  }

  public async getWalletKey(): Promise<string> {
    var path = require('path');
    const dirname = path.basename(__dirname);
    const wallets = config.showrunnerWallets[`${dirname}`];
    const currentWalletInfo = await showrunnersHelper.getValidWallet(dirname, wallets);
    const walletKeyID = `wallet${currentWalletInfo.currentWalletID}`;
    const walletKey = wallets[walletKeyID];
    return walletKey;
  }

  public async sendMessageToContract(simulate) {
    const cache = this.cached;
    const logger = this.logger;
    if (!this.initalized) {
      await this.initialize();
    }
    const sdk = this.sdk;

    logger.debug(`[${new Date(Date.now())}]-[Yam Governance]- Checking for new proposals...`);

    // Overide logic of need be
    //

    const logicOverride =
      typeof simulate == 'object'
        ? simulate.hasOwnProperty('logicOverride') && simulate.logicOverride.mode
          ? simulate.logicOverride.mode
          : false
        : false;

    const epnsNetwork =
      logicOverride && simulate.logicOverride.hasOwnProperty('epnsNetwork')
        ? simulate.logicOverride.epnsNetwork
        : config.web3RopstenNetwork;

    const yamGovernanceNetwork =
      logicOverride && simulate.logicOverride.hasOwnProperty('yamNetwork')
        ? simulate.logicOverride.yamNetwork
        : config.web3KovanNetwork;

    //
    // -- End Override logic

    const yamGov = await sdk.getContract(
      yamGovernanceSettings.yamGovernanceDeployedContract,
      JSON.stringify(yamGovernanceDeployedContractABI),
    );

    // Initailize block if it is missing
    let cachedBlock = await cache.getCache(BLOCK_NUMBER);

    logger.info('[Yam Governance] CACHED BLOCK', cachedBlock);

    if (!cachedBlock) {
      cachedBlock = 0;
      logger.debug(
        `[${new Date(
          Date.now(),
        )}]-[Yam Governance]- Initialized flag was not set, first time initalzing, saving latest block of blockchain where everest contract is...`,
      );
      yamGov.provider
        .getBlockNumber()
        .then(blockNumber => {
          logger.debug(`[${new Date(Date.now())}]-[Yam Governance]- Current block number is... %s`, blockNumber);
          cache.setCache(BLOCK_NUMBER, blockNumber);
          logger.info('Initialized Block Number: %s', blockNumber);
        })
        .catch(err => {
          logger.debug(
            `[${new Date(Date.now())}]-[Yam Governance]- Error occurred while getting Block Number: %o`,
            err,
          );
        });
    }

    // Override logic if need to be
    //

    const fromBlock =
      logicOverride && simulate.logicOverride.hasOwnProperty('fromBlock')
        ? Number(simulate.logicOverride.fromBlock)
        : Number(cachedBlock);
    const toBlock =
      logicOverride && simulate.logicOverride.hasOwnProperty('toBlock')
        ? Number(simulate.logicOverride.toBlock)
        : 'latest';

    //
    // END OVERRIDE LOGIC

    logger.info('yam send_notficiation from block');

    // Check for NewProposal Created event

    this.getNewProposals(yamGovernanceNetwork, yamGov, fromBlock, toBlock, simulate)
      .then(async (info: any) => {
        // First save the block number
        cache.setCache(BLOCK_NUMBER, info.lastBlock);

        //Check if there are events else return
        if (info.eventCount == 0) {
          logger.info('No new Proposal...');
        }
        
        // Otherwise process those proposals
        for (let i = 0; i < info.eventCount; i++) {
          //console.log(info.log[i]);
          let proposer = info.log[i].args.proposer;
          let description = info.log[i].args.description;
          const title = 'New Proposal!';
          const body = proposer + ' just Proposed - ' + description;
          const payloadTitle = 'New Proposal!';
          const payloadMsg =
            'New proposal in YAM finance.\n\n[d: Proposer]: ${proposer}\n[s: Description:] ${description}. [timestamp: ${Math.floor(new Date() / 1000)}]';
          const notificationType = 1;
          const ctaLink = 'https://forum.yam.finance/';
          const tx = await this.sendNotification(
            '0xf69389475E082f4BeFDb9dee4a1E9fe6cd29f6e7',
            title,
            body,
            payloadTitle,
            payloadMsg,
            notificationType,
            ctaLink,
            simulate,
          );

          logger.info(tx);
        }
      })
      .catch(err => {
        logger.debug(
          `[${new Date(Date.now())}]-[Yam Governancd]- 🔥Error --> Unable to obtain new proposal's event: %o`,
          err,
        );
      });
  }

  public async getNewProposals(web3Network, yamGov, fromBlock, toBlock, simulate) {
    const logger = this.logger;
    const cache = this.cached;

    logger.debug(`[${new Date(Date.now())}]-[Yam Governance]- Getting eventLog, eventCount, blocks...`);

    // Check if yamGov is initialised
    if (!yamGov) {
      // check and recreate provider mostly for routes
      logger.info(
        `[${new Date(Date.now())}]-[Yam Governance]- Mostly coming from routes... rebuilding interactable erc20s`,
      );

      yamGov = await this.sdk.getContract(
        yamGovernanceSettings.yamGovernanceDeployedContract,
        JSON.stringify(yamGovernanceDeployedContractABI),
      );

      logger.info(`[${new Date(Date.now())}]-[Yam Governance]- Rebuilt Yam Governance --> %o`);
    }

    // If toBlock is not specified use the latest block
    if (!toBlock) {
      logger.info(
        `[${new Date(Date.now())}]-[Yam Governance]- Mostly coming from routes... resetting toBlock to latest`,
      );
      toBlock = 'latest';
    }

    let result = new Promise(async (resolve, reject) => {
      const filter = yamGov.contract.filters.ProposalCreated();
      logger.debug(
        `[${new Date(Date.now())}]-[Yam Governance]- Looking for ProposalCreated() from %d to %s`,
        fromBlock,
        toBlock,
      );

      yamGov.contract
        .queryFilter(filter, fromBlock, toBlock)
        .then(async eventLog => {
          logger.debug(`[${new Date(Date.now())}]-[Yam Governance]- ProposalCreated() --> %o`, eventLog);

          // Get the latest block
          try {
            toBlock = await yamGov.provider.getBlockNumber();
            logger.debug(`[${new Date(Date.now())}]-[Yam Governance]- Latest block updated to --> %s`, toBlock);
          } catch (err) {
            logger.debug(
              `[${new Date(Date.now())}]-[Yam Governance]- !Errored out while fetching Block Number --> %o`,
              err,
            );
          }

          const info = {
            change: true,
            log: eventLog,
            blockChecker: fromBlock,
            lastBlock: toBlock,
            eventCount: eventLog.length,
          };

          resolve(info);

          logger.debug(
            `[${new Date(
              Date.now(),
            )}]-[Yam Governance]- Events retreived for ProposalCreated() call of Yam Governance Contract --> %d Events`,
            eventLog.length,
          );
        })
        .catch(err => {
          logger.debug(`[${new Date(Date.now())}]-[Yam Governance]- Unable to obtain query filter, error: %o`, err);

          resolve({
            success: false,
            err: 'Unable to obtain query filter, error: %o' + err,
          });
        });
    });

    return await result;
  }

  public async sendNotification(subscriber, title, body, payloadTitle, payloadMsg, notificationType, cta, simulate) {
    const logger = this.logger;
    const epns = this.getEPNSInteractableContract(config.web3RopstenNetwork);
    const payload: any = await epnsNotifyHelper.preparePayload(
      null,
      notificationType,
      title,
      body,
      payloadTitle,
      payloadMsg,
      cta,
      null,
    );

    logger.debug('Payload Prepared: %o' + JSON.stringify(payload));

    const txn = await epnsNotifyHelper
      .uploadToIPFS(payload, logger, simulate)
      .then(async ipfshash => {
        logger.debug('Success --> uploadToIPFS(): %o' + ipfshash);
        const storageType = 1; // IPFS Storage Type
        const txConfirmWait = 0; // Wait for 0 tx confirmation
        // Send Notification

        const notification = await epnsNotifyHelper
          .sendNotification(
            epns.signingContract, // Contract connected to signing wallet
            subscriber, // Recipient to which the payload should be sent
            parseInt(payload.data.type), // Notification Type
            storageType, // Notificattion Storage Type
            ipfshash, // Notification Storage Pointer
            txConfirmWait, // Should wait for transaction confirmation
            logger, // Logger instance (or console.log) to pass
            simulate, // Passing true will not allow sending actual notification
          )
          .then((tx: any) => {
            logger.debug('Transaction mined: %o | Notification Sent ' + tx.hash);
            logger.debug('🙌 YAM Governance Channel Logic Completed!');
            return tx;
          })
          .catch(err => {
            logger.error('🔥Error --> sendNotification(): %o', err);
          });

        return notification;
      })
      .catch(err => {
        logger.error('🔥Error --> Unable to obtain ipfshash, error: %o' + err.message);
      });

    return txn;
  }

  public getEPNSInteractableContract(web3network) {
    this.logger.debug('[Yam governance sendNotification] - Getting EPNS interactable contract ');
    // Get Contract
    return epnsNotifyHelper.getInteractableContracts(
      web3network, // Network for which the interactable contract is req
      {
        // API Keys
        etherscanAPI: config.etherscanAPI,
        infuraAPI: config.infuraAPI,
        alchemyAPI: config.alchemyAPI,
      },
      this.walletKey, // Private Key of the Wallet sending Notification
      config.deployedContract, // The contract address which is going to be used
      config.deployedContractABI, // The contract abi which is going to be useds
    );
  }
}
