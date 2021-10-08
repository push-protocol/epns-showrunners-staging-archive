import { Contract } from 'ethers';
import { Inject } from 'typedi';
import { BaseProvider } from '@ethersproject/providers';
import showrunnersHelper from '../../helpers/showrunnersHelper';
import moverSettings from './moverSettings.json';
import abi from './mover.json';
import erc20Abi from './erc20.json';
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
export class MoverChannel {
  constructor(@Inject('logger') private logger, @Inject('cached') private cached) {}

  // ___________
  //
  // HELPERS
  //
  // ___________

  async log(inp: string) {
    this.logger.info(`[${new Date(Date.now())}]-[Mover]- ` + inp);
  }

  async logObject(inp: any) {
    this.logger.info(`[${new Date(Date.now())}]-[Mover]- `);
    this.logger.info(inp);
  }

  async logError(err: any) {
    this.logger.error(`[${new Date(Date.now())}]-[Mover]- ` + err);
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
    let cntrct = await sdk.getContract(moverSettings.moverHolyRedeemerAddress, JSON.stringify(abi));

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

  get timestamp() {
    return Math.floor(Date.now() / 1000);
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

  async checkForYieldDistributed(simulate) {
    try {
      this.log('IDLE Governance Task');
      const helpers = await this.getHelpers(simulate);
      const sdk: epnsHelper = helpers.sdk;
      const epns = helpers.epns;

      let mover = helpers.cntrct;

      let evts = await this.fetchYieldDistributedEvents(mover, helpers.fromBlock, helpers.toBlock);
      if (evts.eventCount == 0) this.log('NO Yield Distribution events found');
      else {
        for (const item of evts.log) {
          try {
            let e = item.args;

            const title = 'Yield Distributed';
            const erc20 = await sdk.getContract(e[0], JSON.stringify(erc20Abi));
            const symbol = await erc20.contract.symbol();

            const msg = `Yield amount ${e[1]} has been distributed for ${symbol}[timestamp:${this.timestamp}]`;
            console.log(msg);
            await this.prepareAndSendNotification(helpers.sdk, helpers.epns, simulate, {
              recipientAddr: '0xbFCe359B6A4f04ae6d16d0aFb8976205986F4dDb',
              payloadType: 3,
              title: title,
              body: msg,
              payloadCTA: `https://viamover.com`,
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
  async fetchYieldDistributedEvents(
    mover: {
      provider: BaseProvider;
      contract: Contract;
      signingContract: Contract;
    },
    fromBlock,
    toBlock,
  ) {
    const filter = mover.contract.filters.YieldDistributed();
    try {
      this.log(`Fetching Yield Distributed events fromBlock : ${fromBlock} toBlock: ${toBlock}`);
      const events = await mover.contract.queryFilter(filter, fromBlock, toBlock);
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
