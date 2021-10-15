import { Contract } from 'ethers';
import { Inject } from 'typedi';
import { BaseProvider } from '@ethersproject/providers';
import showrunnersHelper from '../../helpers/showrunnersHelper';

import rabbitholeSettings from './rabbitholeSettings.json';
import abi from './rabbithole.json';
import epnsHelper, { InfuraSettings, NetWorkSettings, EPNSSettings } from '@epnsproject/backend-sdk-staging';
import config from '../../config';

import axios from 'axios';

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

interface Quest {
  name: string;
  description: string;
  id: string;
  questStart: string;
  questEnd: string;
  slug: string;
  isDisabled: boolean;
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
export class RabbitHoleChannel {
  constructor(@Inject('logger') private logger, @Inject('cached') private cached) {}

  // ___________
  //
  // HELPERS
  //
  // ___________

  async log(inp: string) {
    this.logger.info(`[${new Date(Date.now())}]-[RabbitHole]- ` + inp);
  }

  async logObject(inp: any) {
    this.logger.info(`[${new Date(Date.now())}]-[RabbitHole]- `);
    this.logger.info(inp);
  }

  async logError(err: any) {
    this.logger.error(`[${new Date(Date.now())}]-[RabbitHole]- ` + err);
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
    let cntrct = await sdk.getContract(rabbitholeSettings.contractAddress, JSON.stringify(abi));

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

  async checkForNewQuests(simulate) {
    try {
      let quests = await this.fetchRecentQuests();
      const helpers = await this.getSdks();
      const sdk: epnsHelper = helpers.sdk;
      const epns = helpers.epns;
      for (let i of quests) {
        this.log(`questEnd : ${i.questEnd}, dateNow: ${Date.now()}`);
        if (Date.parse(i.questEnd) > Date.now()) {
          this.log('Sending Notifications');

          const title = 'New Quest';
 console.log(1)

          const msg = `${i.name}\n\n${i.description}`;
          console.log(`https://app.rabbithole.gg/quests/${i.slug}`)
          await this.prepareAndSendNotification(helpers.sdk, helpers.epns, simulate, {
            recipientAddr: '0x6bf1ee9DE5D11Fa558c1FA8D8855E26C38Fa582A',
            payloadType: 3,
            title: title,
            body: msg,
            payloadCTA: `https://app.rabbithole.gg/quests/${i.slug}`,
            payloadImg: null,
            payloadMsg: msg,
            payloadTitle: title,
            notificationType: simulate?.txOverride ?? 1,
          });
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

  async fetchRecentQuests() {
    let quests = (await axios.get<Quest[]>('https://0pdqa8vvt6.execute-api.us-east-1.amazonaws.com/app/quests')).data;

    return quests;
  }
}
