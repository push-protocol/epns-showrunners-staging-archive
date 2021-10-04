import { Inject, Service } from 'typedi';
import config, { settings } from '../../config';
import showrunnersHelper from '../../helpers/showrunnersHelper';
import { request, gql } from 'graphql-request';
import channelSettings from './cviSettings.json';
import cviEthPlatformABI from './cviEthPlatform.json';
import cviEthPlatformLiquidationABI from './cviEthPlatformLiquidation.json';
import epnsHelper from '@epnsproject/backend-sdk-staging';
import axios from 'axios';
import { Contract } from '@ethersproject/contracts';
import { BaseProvider } from '@ethersproject/providers';
import { over, reduceRight } from 'lodash';
import { BigNumber } from 'ethers';

interface PayloadDetails {
  recipientAddr: any;
  payloadType: any;
  title: any;
  body: any;
  payloadTitle: any;
  payloadMsg: any;
  payloadCTA: any;
  payloadImg: any;
}

interface Position {
  address: string;
  positionUnitsAmount: BigNumber;
  leverage: number;
  openCVIValue: number;
  creationTimestamp: number;
  originalCreationTimestamp: number;
}

interface PositionBalance {
  currentPositionBalance: BigNumber;
  isPositive: boolean;
  positionUnitsAmount: BigNumber;
  leverage: number;
  fundingFees: BigNumber;
  marginDebt: BigNumber;
}

const BLOCK_NUMBER = 'block_number';

@Service()
export default class CviChannel {
  channelName = 'CVI';
  cviEthPlatform: {
    provider: BaseProvider;
    contract: Contract;
    signingContract: Contract | null;
  };
  cviEthPlatformLiquidation: {
    provider: BaseProvider;
    contract: Contract;
    signingContract: Contract | null;
  };

  constructor(@Inject('logger') private logger, @Inject('cached') private cached) {}

  //
  // Showrunners
  //
  async checkForLiquidationRisks(simulate) {
    try {
      const override = simulate?.logicOverride;
      this.log('Check for liquidation risks task begins');
      let sdks = await this.getHelpers(simulate);
      let users = override ? simulate?.users ?? [] : await sdks.sdk.getSubscribedUsers();
      for (const u of users) {
        let shoudlNotify = override || (await this.processLiquidationCheck(sdks));
        const title = `Liquidation Risk`;
        const msg = `Your position is at [d:risk of liquidation] please take appropriate steps`;
        await this.prepareAndSendNotification(sdks.sdk, sdks.epns, simulate, {
          title: title,
          body: msg,
          payloadTitle: title,
          payloadMsg: msg,
          payloadImg: null,
          payloadCTA: 'https://cvi.finance',
          payloadType: 3,
          recipientAddr: u,
        });
      }
    } catch (error) {
      this.logError(error);
    }
  }

  //
  //
  async checkForPriceVariations(simulate) {
    try {
      let sdks = await this.getSdks();
      let sdk = sdks.sdk;
      const override = simulate?.logicOverride;
      let prices = await this.fetchPriceData();
      let final = override ? simulate?.final : prices.final[1];
      let prev = override ? simulate?.prev : prices.prev[1];
      let percentageChange = ((final - prev) * 100) / prev;
      let absolutePercentageChange = Math.abs(percentageChange);
      let word: string;

      if (percentageChange < -10) {
        word = '[d:wropped]';
      } else {
        word = '[s:went up]';
      }

      const title = 'Index Variation';
      const msg = `The index value ${word} ${Math.floor(percentageChange)}% in 1 hour`;

      await this.prepareAndSendNotification(sdk, sdks.epns, simulate, {
        payloadType: 1,
        title: title,
        body: msg,
        payloadTitle: title,
        payloadMsg: msg,
        payloadCTA: 'https://cvi.finance',
        payloadImg: null,
        recipientAddr: '0x5Ec81a0A70Ee9617e06021B951D97A237917C6A0',
      });
    } catch (error) {
      this.logError(error);
    }
  }

  //
  //
  // Helpers
  //
  //

  private async getWalletKey() {
    var path = require('path');
    const dirname = path.basename(__dirname);
    const wallets = config.showrunnerWallets[`${dirname}`];
    const currentWalletInfo = await showrunnersHelper.getValidWallet(dirname, wallets);
    const walletKeyID = `wallet${currentWalletInfo.currentWalletID}`;
    const walletKey = wallets[walletKeyID];
    return walletKey;
  }

  private getLog(inp: string) {
    return `[${new Date(Date.now())}]-[${this.channelName}]- ` + inp;
  }

  private log(inp: string) {
    this.logger.info(this.getLog(inp));
  }

  private logError(inp: any) {
    this.logger.error(this.getLog(inp));
  }

  private logObject(inp: any) {
    this.logger.info(inp);
  }

  private async getHelpers(simulate) {
    let sdks = await this.getSdks();
    let sdk = sdks.sdk;

    this.cviEthPlatform =
      this.cviEthPlatform ??
      (await sdk.getContract(channelSettings.cviEthPlatformContractAddress, JSON.stringify(cviEthPlatformABI)));

    this.cviEthPlatformLiquidation =
      this.cviEthPlatformLiquidation ??
      (await sdk.getContract(
        channelSettings.cviEthPlatformLiquidationContractAddress,
        JSON.stringify(cviEthPlatformLiquidationABI),
      ));

    const logicOverride =
      typeof simulate == 'object'
        ? simulate.hasOwnProperty('logicOverride') && simulate.logicOverride.mode
          ? simulate.logicOverride.mode
          : false
        : false;

    // Initailize block if it is missing
    let cachedBlock = (await this.cached.getCache(BLOCK_NUMBER)) ?? 0;
    this.logger.info(this.getLog(`Cached block ${cachedBlock}`));
    let blockNumber = await this.cviEthPlatform.provider.getBlockNumber();
    if (cachedBlock === 0) {
      this.cached.setCache(BLOCK_NUMBER, blockNumber);
    }

    const fromBlock =
      logicOverride && simulate.logicOverride.hasOwnProperty('fromBlock')
        ? Number(simulate.logicOverride.fromBlock)
        : Number(cachedBlock);

    const toBlock =
      logicOverride && simulate.logicOverride.hasOwnProperty('toBlock')
        ? Number(simulate.logicOverride.toBlock)
        : await this.cviEthPlatform.provider.getBlockNumber();

    return {
      logicOverride: logicOverride,
      fromBlock: fromBlock,
      toBlock: toBlock,
      sdk: sdk,
      epns: sdks.epns,
      cviEthPlatform: this.cviEthPlatform,
      cviEthPlatformLiquidation: this.cviEthPlatformLiquidation,
    };
  }

  private async getSdks() {
    this.logger.info(this.getLog('getSdksHelper called'));
    const walletKey = await this.getWalletKey();
    const sdk: epnsHelper = new epnsHelper(
      config.web3MainnetNetwork,
      walletKey,
      settings.networksettings,
      settings.epnsSettings,
    );
    const epns = sdk.advanced.getInteractableContracts(
      config.web3RopstenNetwork,
      settings.networksettings,
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

  private async prepareAndSendNotification(sdk: epnsHelper, epns, simulate, details: PayloadDetails) {
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
    this.logger.info(payload);
    let ipfsHash = await sdk.advanced.uploadToIPFS(payload, this.logger, null, simulate);
    // ipfsHash = 'bafkreihrksuzasvfmozci4pqigwjo3bjbn7aeaolbvuua4uc5vr4p6373u';
    this.logger.info(this.getLog(`IPFS : https://ipfs.io/ipfs/${ipfsHash}`));
    await sdk.advanced.sendNotification(
      epns.signingContract,
      details.recipientAddr,
      3,
      1,
      ipfsHash,
      1,
      this.logger,
      simulate,
    );
  }

  //
  // Fetchers
  //

  private async fetchPriceData() {
    let res = await axios({
      method: 'get',
      url: 'https://api.cvi.finance/cvx',
      headers: {},
    });

    let prices = res.data.cvixData;
    return { final: prices[prices.length - 1], prev: prices[prices.length - 2] };
  }

  private async processLiquidationCheck(sdks): Promise<boolean> {
    let cvi = sdks.cviEthPlatform;
    let cviEthLiquidation = sdks.cviEthPlatformLiquidation;

    this.log(`Fetching positions from CVI platform`);
    let positionRaw = await cvi.contract.positions('0xab450D37F5C8148f4125734C645F3E777a90f003');
    let position: Position = {
      address: '0xab450D37F5C8148f4125734C645F3E777a90f003',
      positionUnitsAmount: positionRaw[0],
      leverage: positionRaw[1],
      openCVIValue: positionRaw[2],
      creationTimestamp: positionRaw[3],
      originalCreationTimestamp: positionRaw[4],
    };

    let positionBalanceRaw = await cvi.contract.calculatePositionBalance('0xab450D37F5C8148f4125734C645F3E777a90f003');

    let positionBalance: PositionBalance = {
      currentPositionBalance: positionBalanceRaw[0],
      isPositive: positionBalanceRaw[1],
      positionUnitsAmount: positionBalanceRaw[2],
      leverage: positionBalanceRaw[3],
      fundingFees: positionBalanceRaw[4],
      marginDebt: positionBalanceRaw[5],
    };

    const liquid = await this.getLiquidationDetails(cviEthLiquidation.contract, positionBalance);
    let sendNotification = await this.checkLiquidation(
      positionBalance,
      position,
      liquid.liquidationMinThresholdPercent,
      20000,
      liquid.liquidationMaxFeePercentage,
    );

    return sendNotification;
  }

  private async getLiquidationDetails(
    cviEthLiquidationContract: Contract,
    positionBalance: PositionBalance,
  ): Promise<{ liquidationMinThresholdPercent: any; liquidationMaxFeePercentage: any }> {
    this.log(`Fetching liquidationMinThresholdPercents of leverage ${positionBalance.leverage}`);
    let liquidationMinThresholdPercent = await cviEthLiquidationContract.liquidationMinThresholdPercents(
      positionBalance.leverage,
    );
    this.log(`liquidationMinThresholdPercents[${positionBalance.leverage}]  : ${liquidationMinThresholdPercent}`);

    this.log(`Fetching liquidationMaxFeePercentage`);
    let liquidationMaxFeePercentage = await cviEthLiquidationContract.LIQUIDATION_MAX_FEE_PERCENTAGE();

    this.log(`liquidationMaxFeePercentage : ${liquidationMaxFeePercentage}`);

    return {
      liquidationMaxFeePercentage: liquidationMaxFeePercentage,
      liquidationMinThresholdPercent: liquidationMinThresholdPercent,
    };
  }
  private async checkLiquidation(
    posBal: PositionBalance,
    pos: Position,
    liquidationMinThresholdPercent: number,
    maxCviValue: number,
    liquidationMaxFeePercentage: number,
  ): Promise<boolean> {
    this.log(`liquidationMaxFeePercentage: ${liquidationMaxFeePercentage}`);
    this.log(`posBal.positionUnitsAmount : ${posBal.positionUnitsAmount}`);
    this.log(`pos.openCVIValue: ${pos.openCVIValue}`);
    this.log(`maxCviValue: ${maxCviValue}`);
    this.log(`pos.leverage: ${pos.leverage}`);
    this.log(`posBal.currentPositionBalance: ${posBal.currentPositionBalance}`);

    let comparer = posBal.positionUnitsAmount
      .mul(liquidationMinThresholdPercent)
      .mul(pos.openCVIValue)
      .div(maxCviValue)
      .div(pos.leverage);

    this.log(`Comparer : ${comparer.toString()}`);

    comparer = comparer.div(liquidationMaxFeePercentage);
    let shouldSentWarning =
      !posBal.isPositive ||
      posBal.currentPositionBalance.lte(comparer) ||
      (posBal.currentPositionBalance.gte(comparer) && posBal.currentPositionBalance.lte(comparer.mul(102).div(100)));

    return shouldSentWarning;
  }
}
