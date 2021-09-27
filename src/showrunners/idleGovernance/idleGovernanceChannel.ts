import { Contract } from 'ethers';
import { Inject } from 'typedi';
import { BaseProvider } from '@ethersproject/providers';
import showrunnersHelper from '../../helpers/showrunnersHelper';
import idleGovSettings from './idleGovernanceSettings.json';
import abi from './idleGovernance.json';
import epnsHelper, { InfuraSettings, NetWorkSettings, EPNSSettings } from '@epnsproject/backend-sdk-staging';
import config from '../../config';

const infuraSettings: InfuraSettings = {
  projectID: config.infuraAPI.projectID,
  projectSecret: config.infuraAPI.projectSecret,
};

interface PayloadDetails {
  recipientAddr: any;
  payloadType: any;
  title: any;
  body: any;
  payloadTitle: any;
  payloadMsg: any;
  payloadCTA: any;
  payloadImg: any;
  notificationType: any;
}

const epnsSettings: EPNSSettings = {
  network: config.web3RopstenNetwork,
  contractAddress: config.deployedContract,
  contractABI: config.deployedContractABI,
};

const settings: NetWorkSettings = {
  alchemy: config.alchemyAPI,
  infura: infuraSettings,
  etherscan: config.etherscanAPI,
};

const BLOCK_NUMBER = 'block_number';
export class IdleGovernanceChannel {
  constructor(@Inject('logger') private logger, @Inject('cached') private cached) {}

  // ___________
  //
  // HELPERS
  //
  // ___________

  async log(inp: string) {
    this.logger.info(`[${new Date(Date.now())}]-[ProofOfHumanity]- ` + inp);
  }

  async logObject(inp: any) {
    this.logger.info(`[${new Date(Date.now())}]-[ProofOfHumanity]- `);
    this.logger.info(inp);
  }

  async logError(err: any) {
    this.logger.error(`[${new Date(Date.now())}]-[IDLE Governanace]- ` + err);
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

  async getHelpers(simulate) {
    this.log('Getting Helpers');
    let sdks = await this.getSdks();
    let sdk = sdks.sdk;
    let cntrct = await sdk.getContract(idleGovSettings.idleGovernanceDeployedContract, JSON.stringify(abi));

    const logicOverride =
      typeof simulate == 'object'
        ? simulate.hasOwnProperty('logicOverride') && simulate.logicOverride.mode
          ? simulate.logicOverride.mode
          : false
        : false;

    // Initailize block if it is missing
    let cachedBlock = (await this.cached.getCache(BLOCK_NUMBER)) ?? (await cntrct.provider.getBlockNumber());
    this.log(`Cached block ${cachedBlock}`);

    const fromBlock =
      logicOverride && simulate.logicOverride.hasOwnProperty('fromBlock')
        ? Number(simulate.logicOverride.fromBlock)
        : Number(cachedBlock);

    const toBlock =
      logicOverride && simulate.logicOverride.hasOwnProperty('toBlock')
        ? Number(simulate.logicOverride.toBlock)
        : await cntrct.provider.getBlockNumber();

    this.log('Helpers loaded');

    if (!(logicOverride && simulate.logicOverride.hasOwnProperty('toBlock'))) {
      this.cached.setCache(BLOCK_NUMBER, toBlock);
    }

    return {
      logicOverride: logicOverride,
      fromBlock: fromBlock,
      toBlock: toBlock,
      sdk: sdk,
      epns: sdks.epns,
      cntrct: cntrct,
    };
  }

  async getSdks() {
    this.log('getSdksHelper called');
    const walletKey = await this.getWalletKey();
    const sdk: epnsHelper = new epnsHelper(config.web3MainnetNetwork, walletKey, settings, epnsSettings);
    const epns = sdk.advanced.getInteractableContracts(
      config.web3RopstenNetwork,
      settings,
      walletKey,
      config.deployedContract,
      config.deployedContractABI,
    );
    return {
      sdk: sdk,
      epns: epns,
      walletKey: walletKey,
    };
  }

  async prepareAndSendNotification(sdk: epnsHelper, epns, simulate, details: PayloadDetails) {
    const payload = await sdk.advanced.preparePayload(
      details.recipientAddr,
      details.payloadType,
      details.title,
      details.body,
      details.payloadTitle,
      details.body,
      details.payloadCTA,
      null,
    );

    const ipfsHash = await sdk.advanced.uploadToIPFS(payload, this.logger, null, simulate);

    const tx = await sdk.advanced.sendNotification(
      epns.signingContract,
      details.recipientAddr,
      details.notificationType,
      1,
      ipfsHash, 
      1,
      this.logger,
      simulate,
    );
  }

  // -----------
  // Showrunners
  // -----------

  async checkForNewGovernanceProposals(simulate) {
    try {
      this.log('IDLE Governance Task');
      const helpers = await this.getHelpers(simulate);
      const sdk: epnsHelper = helpers.sdk;
      const epns = helpers.epns;

      let idleGov = helpers.cntrct;

      let evts = await this.fetchRecentGovernanceProposals(idleGov, helpers.fromBlock, helpers.toBlock);
      if (evts.eventCount == 0) this.log('NO Proposals Found');
      else {
        for (const item of evts.log) {
          try {
            let e = item.args;

            this.log(`Sending notification for Proposal ID: ${e[0]}`);
            this.log(`========================== ${e[8]}`);
            const title = 'New Proposal';
            const msg = `${e[1]} Just proposed ${e[8]}`;
            await this.prepareAndSendNotification(helpers.sdk, helpers.epns, simulate, {
              recipientAddr: '0x6bf1ee9DE5D11Fa558c1FA8D8855E26C38Fa582A',
              payloadType: 3,
              title: title,
              body: msg,
              payloadCTA: 'https://idle.finance',
              payloadImg: null,
              payloadMsg: msg,
              payloadTitle: title,
              notificationType: simulate?.txOverride ?? 1,
            });
          } catch (error) {
            this.logError(error);
          }
        }
      }
    } catch (error) {
      this.logError(error);
    }
  }

  // _________
  //
  // Fetchers
  // _________

  // Fetch recent removal requests in a given time period
  async fetchRecentGovernanceProposals(
    idleGov: {
      provider: BaseProvider;
      contract: Contract;
      signingContract: Contract;
    },
    fromBlock,
    toBlock,
  ) {
    const filter = idleGov.contract.filters.ProposalCreated();
    try {
      this.log(`Fetching Recent Removal Requests fromBlock : ${fromBlock} toBlock: ${toBlock}`);
      const events = await idleGov.contract.queryFilter(filter, fromBlock, toBlock);
      this.log('Events Fetched Successfully');
      this.cached.setCache(BLOCK_NUMBER, toBlock + 1);
      return {
        change: true,
        log: events,
        blockChecker: fromBlock,
        lastBlock: toBlock,
        eventCount: events.length,
      };
    } catch (err) {
      this.logError(err);
      return {
        success: false,
        err: 'Unable to obtain query filter, error : %o' + err,
      };
    }
  }
}
