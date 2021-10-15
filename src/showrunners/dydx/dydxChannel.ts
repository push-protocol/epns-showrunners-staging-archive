import { Inject, Service } from 'typedi';
import config from '../../config';
import showrunnersHelper from '../../helpers/showrunnersHelper';

import dydxSettings from './dydxSettings.json';
import dydxABI from './dydx.json';
import epnsHelper, { InfuraSettings, NetWorkSettings, EPNSSettings } from '@epnsproject/backend-sdk-staging';

import { Contract } from '@ethersproject/contracts';
import { BaseProvider } from '@ethersproject/providers';
import { reduceRight } from 'lodash';
import { ethers } from 'ethers';
import 'ipfs-http-client';

import axios from 'axios';

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

const BLOCK_NUMBER = 'block_number';

const infuraSettings: InfuraSettings = {
  projectID: config.infuraAPI.projectID,
  projectSecret: config.infuraAPI.projectSecret,
};

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

@Service()
export default class DYDXChannel {
  name = 'dYdX';

  constructor(@Inject('logger') private logger, @Inject('cached') private cached) {}

  //
  //
  // Helpers
  //
  //

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
    let cntrct = await sdk.getContract(dydxSettings.governorContractAddress, JSON.stringify(dydxABI));

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

  //
  // Loggers
  //

  getLog(inp: string) {
    return `[${new Date(Date.now())}]-[dYdX]- ` + inp;
  }

  async log(inp: string) {
    this.logger.info(this.getLog(inp));
  }

  async logObject(inp: any) {
    this.logger.info(this.getLog(''));
    this.logger.info(inp);
  }

  async logError(err: any) {
    this.logger.error(this.getLog(err));
  }

  //
  // Showrunners
  //

  async proposalCreatedTask(simulate) {
    const helpers = await this.getHelpers(simulate);
    const dydx = helpers.cntrct;
    const filter = dydx.contract.filters.ProposalCreated();
    const evts = await this.fetchEvents(filter, dydx, helpers.fromBlock, helpers.toBlock);

    for (let i = 0; i < evts.eventCount; i++) {
      console.log(evts.logs[i]);
      const proposal = evts.logs[i].args;
      // 0 -> ID
      // 1 -> Creator
      // 11 -> ipfsHash
      this.log(proposal[11]);
      const p = {
        id: proposal[0],
        creator: proposal[1],
        ipfsHash: this.getIPFSHash(''),
      };

      this.log(`ID: ${proposal[0]}, Creator: ${proposal[1]}, ipfsHash: ${p.ipfsHash}`);
      const d = await this.getIPFSPayload(p.ipfsHash);
      this.log(`Got Proposal Details`);
      this.logObject(d);

      const title = 'New Proposal';
      const msg = `DIP : ${d.DIP}\n\n[b:${d.title}]\n\n${d.shortDescription}\n`;

      await this.prepareAndSendNotification(helpers.sdk, helpers.epns, simulate, {
        recipientAddr: '0x6ed071Ed7aB909eCE15B8eDF3d92dEEED81c0F00',
        payloadType: 3,
        title: title,
        body: msg,
        payloadCTA: `https://dydx.community/dashboard/proposal/${proposal[0].toString()}`,
        payloadImg: null,
        payloadMsg: msg,
        payloadTitle: title,
        notificationType: simulate?.txOverride ?? 1,
      });
    }
  }

  async proposalQueuedTask(simulate) {
    const helpers = await this.getHelpers(simulate);
    const dydx = helpers.cntrct;
    const filter = dydx.contract.filters.ProposalQueued();
    const evts = await this.fetchEvents(filter, dydx, helpers.fromBlock, helpers.toBlock);
    if (simulate.logicOverride.force) {
      evts.eventCount = 1;
    }
    for (let i = 0; i < evts.eventCount; i++) {
      const proposal = simulate.logicOverride.force ? [0] : evts.logs[i].args;
      // 0 -> ID
      // 1 -> Creator
      // 11 -> ipfsHash
      this.log(proposal[11]);

      const p = {
        id: proposal[0],
        executionTime: proposal[1],
        ipfsHash: this.getIPFSHash(''),
      };

      this.log(`ID: ${proposal[0]}, ipfsHash: ${p.ipfsHash}`);
      const d = await this.getIPFSPayload(p.ipfsHash);
      this.log(`Got Proposal Details`);
      this.logObject(d);

      const title = 'Proposal Queued';
      const msg = `The Proposal DIP #${d.DIP} has been queued\n\n[b:${d.title}]\n\n${
        d.shortDescription
      }[timestamp:${ Date.now() / 1000}]`;

      await this.prepareAndSendNotification(helpers.sdk, helpers.epns, simulate, {
        recipientAddr: '0x6ed071Ed7aB909eCE15B8eDF3d92dEEED81c0F00',
        payloadType: 3,
        title: title,
        body: msg,
        payloadCTA: `https://dydx.community/dashboard/proposal/${proposal[0].toString()}`,
        payloadImg: null,
        payloadMsg: msg,
        payloadTitle: title,
        notificationType: simulate?.txOverride ?? 1,
      });
    }
  }

  async proposalExecutedTask(simulate) {
    const helpers = await this.getHelpers(simulate);
    const dydx = helpers.cntrct;
    const filter = dydx.contract.filters.ProposalExecuted();
    const evts = await this.fetchEvents(filter, dydx, helpers.fromBlock, helpers.toBlock);

    if (simulate.logicOverride.force) {
      evts.eventCount = 1;
    }
    for (let i = 0; i < evts.eventCount; i++) {
      const proposal = simulate.logicOverride.force ? [0] : evts.logs[i].args;

      const p = {
        id: proposal[0],

        ipfsHash: this.getIPFSHash(''),
      };

      this.log(`ID: ${proposal[0]}, ipfsHash: ${p.ipfsHash}`);
      const d = await this.getIPFSPayload(p.ipfsHash);
      this.log(`Got Proposal Details`);
      this.logObject(d);

      const title = 'Proposal Executed';
      const msg = `The Proposal DIP #${d.DIP} - [b:${d.title}] has been executed[timestamp:${ Date.now() / 1000}]`;

      await this.prepareAndSendNotification(helpers.sdk, helpers.epns, simulate, {
        recipientAddr: '0x6ed071Ed7aB909eCE15B8eDF3d92dEEED81c0F00',
        payloadType: 3,
        title: title,
        body: msg,
        payloadCTA: `https://dydx.community/dashboard/proposal/${proposal[0].toString()}`,
        payloadImg: null,
        payloadMsg: msg,
        payloadTitle: title,
        notificationType: simulate?.txOverride ?? 1,
      });
    }
  }
  getIPFSHash(inp) {
    return 'QmZFHNmxsyhNFD96jwoa2eHTMa34KjgP8j7Y9W8URdGeS9';
  }

  async getIPFSPayload(hash) {
    const resp = await axios.get(`http://ipfs.io/ipfs/${hash}`);

    return resp.data;
  }

  async fetchEvents(
    filter: any,
    contract: {
      provider: BaseProvider;
      contract: Contract;
      signingContract: Contract;
    },
    fromBlock,
    toBlock,
  ) {
    try {
      // console.log(ethers.utils.formatBytes32String('QmZFHNmxsyhNFD96jwoa2eHTMa34KjgP8j7Y9W8URdGeS9'));
      this.log('Fetching events');
      const events = await contract.contract.queryFilter(filter, fromBlock, toBlock);

      this.log(`Events Fetched Successfully eventCount:${events.length}`);

      // TODO Set cache  in cron task
      // this.cached.setCache(BLOCK_NUMBER, toBlock + 1);

      return {
        change: true,
        logs: events,
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
