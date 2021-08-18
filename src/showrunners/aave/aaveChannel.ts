// @name: Aave Channel
// @version: 1.0

import { Service, Inject } from 'typedi';
import config from '../../config';
import showrunnersHelper from '../../helpers/showrunnersHelper';
import { ethers, logger} from 'ethers';
import epnsHelper, {InfuraSettings, NetWorkSettings, EPNSSettings} from '@epnsproject/backend-sdk'
import { omit } from 'lodash';

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
const aaveSettings = require('./aaveSettings.json')
const aaveLendingPoolDeployedContractABI = require('./aave_LendingPool.json')
const NETWORK_TO_MONITOR = config.web3PolygonMainnetRPC
const HEALTH_FACTOR_THRESHOLD = 1.6;
const CUSTOMIZABLE_SETTINGS = {
  'precision': 3,
}


@Service()
export default class AaveChannel {
  constructor(
    @Inject('logger') private logger,
  ) {}

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
    const walletKey = await this.getWalletKey()
    const sdk = new epnsHelper(NETWORK_TO_MONITOR, walletKey, settings, epnsSettings);

    //simulate object settings START
    const logicOverride = typeof simulate == 'object' ? ((simulate.hasOwnProperty("logicOverride") && simulate.logicOverride.mode) ? simulate.logicOverride.mode : false) : false;
    const simulateAaveNetwork = logicOverride && simulate.logicOverride.hasOwnProperty("aaveNetwork") ? simulate.logicOverride.aaveNetwork : false;
    let aave: any;
    if(simulateAaveNetwork){
      aave = sdk.advanced.getInteractableContracts(simulateAaveNetwork, settings, walletKey, aaveSettings.aaveLendingPoolDeployedContractPolygonMainnet, aaveLendingPoolDeployedContractABI);
    }
    else{
      aave = await sdk.getContract(aaveSettings.aaveLendingPoolDeployedContractPolygonMainnet, aaveLendingPoolDeployedContractABI)
    }
    //simulate object settings END

    const users = await sdk.getSubscribedUsers()
    const promises = users.map(async(user) => {
      const walletKey = await this.getWalletKey()
      const sdk = new epnsHelper(NETWORK_TO_MONITOR, walletKey, settings, epnsSettings);
      this.checkHealthFactor(aave, user, sdk, simulate)
    })
    return await Promise.all(promises)
  }
  public async checkHealthFactor(aave, userAddress, sdk, simulate) {
    const logger = this.logger;
    //simulate object settings START
    try{
      const logicOverride = typeof simulate == 'object' ? ((simulate.hasOwnProperty("logicOverride") && simulate.logicOverride.mode) ? simulate.logicOverride.mode : false) : false;
      const simulateApplyToAddr = logicOverride && simulate.logicOverride.hasOwnProperty("applyToAddr") ? simulate.logicOverride.applyToAddr : false;
      const simulateAaveNetwork = logicOverride && simulate.logicOverride.hasOwnProperty("aaveNetwork") ? simulate.logicOverride.aaveNetwork : false;
      if(!sdk){
        const walletKey = await this.getWalletKey()
        sdk = new epnsHelper(NETWORK_TO_MONITOR, walletKey, settings, epnsSettings);
      }
      if(!aave){
        aave = await sdk.getContract(aaveSettings.aaveLendingPoolDeployedContractPolygonMainnet, aaveLendingPoolDeployedContractABI)
      }
      if(!userAddress){
        if(simulateApplyToAddr){
          userAddress = simulateApplyToAddr
        }
        else{
          logger.debug(`[${new Date(Date.now())}]-[Aave Channel]- userAddress is not defined`)
        }
      }
    }
    catch(err){
      logger.error(`[${new Date(Date.now())}]-[Aave Channel]- error: ${err}`)
    }
    //simulate object settings END

    const userData = await aave.contract.getUserAccountData(userAddress)
    let  healthFactor = ethers.utils.formatEther(userData.healthFactor)
    logger.info("For wallet: %s, Health Factor: %o", userAddress, healthFactor);
    if(Number(healthFactor) <= HEALTH_FACTOR_THRESHOLD){
      const precision = CUSTOMIZABLE_SETTINGS.precision;
      const newHealthFactor = parseFloat(healthFactor).toFixed(precision);
      const title = "Aave Liquidity Alert!";
      const message =  userAddress + " your account has healthFactor "+ newHealthFactor + ". Maintain it above 1 to avoid liquidation.";
      const payloadTitle = "Aave Liquidity Alert!";
      const payloadMsg = `Dear [d:${userAddress}] your account has healthFactor ${newHealthFactor} . Maintain it above 1 to avoid liquidation.[timestamp: ${Math.floor(new Date() / 1000)}]`;
      const notificationType = 3;
      const tx = await sdk.sendNotification(userAddress, title, message, payloadTitle, payloadMsg, notificationType, simulate)
      logger.info(`[${new Date(Date.now())}]-[Aave Channel]- transaction: %o`, tx)
      return{
        success: true,
        data: tx
      }
    }
    else{
      logger.info(`[${new Date(Date.now())}]-[Aave Channel]- Wallet: ${userAddress} is SAFE with Health Factor:: ${healthFactor}`);
      return{
        success: false,
        data: userAddress + " is not about to get liquidated"
      }
    }
  }
}
