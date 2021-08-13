// @name: ENS Expiry Channel
// @version: 1.0.1
// @recent_changes: ENS Expiry Payload Fix

import { Service, Inject } from 'typedi';
import config from '../../config';
import showrunnersHelper from '../../helpers/showrunnersHelper';
import { ethers, logger} from 'ethers';
import epnsHelper, {InfuraSettings, NetWorkSettings, EPNSSettings} from '@epnsproject/backend-sdk'
const gr = require('graphql-request')
const { request, gql } = gr;

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
const ensSettings = require('./ensSettings.json')
const ensDeployedContractABI = require('./ens_contract.json')
const NETWORK_TO_MONITOR = config.web3RopstenNetwork;
const TRIGGER_THRESHOLD_SECS = 60 * 60 * 24 * 7; // 7 Days

@Service()
export default class EnsExpirationChannel {
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
    try{
      const walletKey = await this.getWalletKey()
      const sdk = new epnsHelper(NETWORK_TO_MONITOR, walletKey, settings, epnsSettings);

      logger.debug(`[${new Date(Date.now())}]-[ENS]-Checking for expired address... `);
      const ens = await sdk.getContract(ensSettings.ensDeployedContract, ensDeployedContractABI)
      const users = await sdk.getSubscribedUsers()
      const promises = users.map(async(user) => {
        const walletKey = await this.getWalletKey()
        const sdk = new epnsHelper(NETWORK_TO_MONITOR, walletKey, settings, epnsSettings);
        this.checkENSDomainExpiry(NETWORK_TO_MONITOR, ens, user, TRIGGER_THRESHOLD_SECS, sdk, simulate)
      })
      return await Promise.all(promises)
    } catch (error) {
      logger.error(`[${new Date(Date.now())}]-[ENS]-Error occurred sending transactions: `, error);
    }
  }

  // To Check for domain expiry
  public async checkENSDomainExpiry(networkToMonitor, ens, userAddress, triggerThresholdInSecs, sdk, simulate) {
    const logger = this.logger;
    let walletKey;
    //simulate object settings START
    try{
      const logicOverride = typeof simulate == 'object' ? ((simulate.hasOwnProperty("logicOverride") && simulate.logicOverride.mode) ? simulate.logicOverride.mode : false) : false;
      const simulateENSNetwork = logicOverride && simulate.logicOverride.hasOwnProperty("network") ? simulate.logicOverride.network : false;
      const simulateApplyToAddr = logicOverride && simulate.logicOverride.hasOwnProperty("applyToAddr") ? simulate.logicOverride.applyToAddr : false;
      const simulateTriggerThresholdInSecs = logicOverride && simulate.logicOverride.hasOwnProperty("triggerThresholdInSecs") ? simulate.logicOverride.triggerThresholdInSecs : false;
      if(!sdk){
        walletKey = await this.getWalletKey()
        sdk = new epnsHelper(NETWORK_TO_MONITOR, walletKey, settings, epnsSettings);
      }
      if(!ens){
        if(simulateENSNetwork){
          ens = sdk.advanced.getInteractableContracts(simulateENSNetwork, settings, walletKey, ensSettings.ensDeployedContract, ensDeployedContractABI);
        }
        else{
          ens = await sdk.getContract(ensSettings.ensDeployedContract, ensDeployedContractABI)
        }
      }
      if(!networkToMonitor){
        if(simulateENSNetwork){
          networkToMonitor = simulateENSNetwork;
        }
        else{
          networkToMonitor = NETWORK_TO_MONITOR
        }
      }
      if(!userAddress){
        if(simulateApplyToAddr){
          userAddress = simulateApplyToAddr;
        }
      }
      if(!triggerThresholdInSecs){
        if(simulateTriggerThresholdInSecs){
          triggerThresholdInSecs = simulateTriggerThresholdInSecs;
        }
      }
    }catch(err){
      logger.error(`[${new Date(Date.now())}]-[ENS]- error: ${err}`)
    }
    //simulate object settings END

    return new Promise(async (resolve) => {

      const ensRoute = "subgraphs/name/dev-cnote/ens"
      const ENS_URL = `${ensSettings.ensEndpoint}${ensRoute}`;
      const address = userAddress.toLowerCase();
      let data = await this.getData(address,ENS_URL)
      if(data.registrations.length == 0){
        resolve({
          success: false,
          err: `ENS name doesn't exist for address: ${userAddress}, skipping...`
        });
      }
      else{
        let loop = data.registrations.length;
        const result =  await this.getDomain(loop,data,address,ENS_URL,ens,triggerThresholdInSecs,networkToMonitor, sdk, simulate)
        if(result.flag){
          // logic loop, it has 7 days or less to expire but not expired
          resolve (this.getENSDomainExpiryPayload(userAddress, result.ensAddressName, result.dateDiff, sdk, simulate))
        }
        else {
          resolve({
            success: false,
            err: "Date Expiry condition unmet for wallet: " + userAddress
          });
        }
      }
    });
  }

  public async getDomain(loop,data,address,ENS_URL,ens,triggerThresholdInSecs,networkToMonitor, sdk,simulate) {
    const logger = this.logger;
     //simulate object settings START
     try{
      const logicOverride = typeof simulate == 'object' ? ((simulate.hasOwnProperty("logicOverride") && simulate.logicOverride.mode) ? simulate.logicOverride.mode : false) : false;
      const simulateApplyToAddr = logicOverride && simulate.logicOverride.hasOwnProperty("applyToAddr") ? simulate.logicOverride.applyToAddr : false;
      const simulateEnsUrl = logicOverride && simulate.logicOverride.hasOwnProperty("ensUrl") ? simulate.logicOverride.ensUrl : false;
      const simulateTriggerThresholdInSecs = logicOverride && simulate.logicOverride.hasOwnProperty("triggerThresholdInSecs") ? simulate.logicOverride.triggerThresholdInSecs : false;
      const simulateNetwork = logicOverride && simulate.logicOverride.hasOwnProperty("network") ? simulate.logicOverride.network : false;
      if(logicOverride){
        address = simulateApplyToAddr;
        ENS_URL = simulateEnsUrl;
        triggerThresholdInSecs = simulateTriggerThresholdInSecs;
        networkToMonitor = simulateNetwork;
      }
      if(!sdk){
        const walletKey = await this.getWalletKey()
        sdk = new epnsHelper(NETWORK_TO_MONITOR, walletKey, settings, epnsSettings);
      }
      if(!ens){
        logger.debug(`[${new Date(Date.now())}]-[ENS]- ENS Interactable Contract not set... mostly coming from routes, setting contract for --> %s`, networkToMonitor);
        ens = await sdk.getContract(ensSettings.ensDeployedContract, ensDeployedContractABI)
      }
      if(!data){
        data = await this.getData(address,ENS_URL);
        loop = data.registrations.length
      }
    }
    catch(err){
      logger.error(`[${new Date(Date.now())}]-[ENS]- error: ${err}`)
    }
    //simulate object settings END
    
    return new Promise(async (resolve) => {

      let dates:number[] = [];
      let ensName:string[] = [];
      let flag:boolean;
      for(let i = 0; i < loop; i++){
        let hashedName = data.registrations[i].domain.labelhash;
        const GET_LABEL_NAME = gql`
        query{
          domains(where:{labelhash:"${hashedName}"}){
            labelName
          }
        }`
        const dataInfo = await request(ENS_URL, GET_LABEL_NAME)
        let ensAddressName = dataInfo.domains[0].labelName;
        const expiredDate = await ens.contract.nameExpires(hashedName)
        // convert the date returned
        let expiryDate = ethers.utils.formatUnits(expiredDate, 0).split('.')[0];
        // get current date
        let currentDate = (new Date().getTime() - new Date().getMilliseconds()) / 1000;
        // get date difference
        let dateDiff = expiryDate - currentDate; // some seconds
        // Log it
        logger.debug(
          `[${new Date(Date.now())}]-[ENS]-Domain %s exists with Expiry Date: %d | Date Diff: %d | Checking against: %d | %o`,
          ensAddressName,
          expiryDate,
          dateDiff,
          triggerThresholdInSecs,
          (dateDiff < triggerThresholdInSecs) ? "Near Expiry! Alert User..." : "Long time to expire, don't alert"
        );

        // if difference exceeds the date, then it's already expired
        if (dateDiff > 0 && dateDiff < triggerThresholdInSecs) {
          dates.push(dateDiff);
          ensName.push(ensAddressName);
          flag = true;
        }
      }
      resolve({
        dateDiff:dates,
        ensAddressName:ensName,
        flag:flag
      })

    })
  }

  private async getData(address,ENS_URL){
    let data;
    const GET_LABEL_NAME = gql`{
      registrations(where:{registrant:"${address}"})
      {
        id
        domain{
          id
          labelhash
        }
      }
    }`

   data = await request(ENS_URL, GET_LABEL_NAME)
   return(data)
  }

	public async getENSDomainExpiryPayload(userAddress, ensAddressName, dateDiff, sdk, simulate) {
    const logger = this.logger;
   
    
    logger.debug(`[${new Date(Date.now())}]-[ENS]-Preparing payload...`);

    let loop = dateDiff.length;
    let numOfDays = [];

    for(let i = 0; i < loop; i++){
      const calNumOfDays = Math.floor(dateDiff[i] / (60 * 60 * 24));
      numOfDays.push(calNumOfDays);
    }

    return await new Promise(async (resolve, reject) => {
      const title = "ENS Domain Expiry Alert!";
      const payloadTitle = "ENS Domain Expiry Alert!";
      let message;
      let payloadMsg;

      if(loop > 1){
        message = "your domains:" + ensAddressName + " are set to expire in " + numOfDays + " days";
        payloadMsg = "[d subscriber your domains:" + ensAddressName + "] are set to expire in " + numOfDays + " days! [timestamp: " + Math.floor(new Date() / 1000) + "]";
      }
      else{
        message = ensAddressName + " is set to expire in " + numOfDays + " days";
        payloadMsg = "[d:" + ensAddressName + "] is set to expire in " + numOfDays + " days! [timestamp: " + Math.floor(new Date() / 1000) + "]";
      }
      const notificationType = 3;
      const tx = await sdk.sendNotification(userAddress, title, message, payloadTitle, payloadMsg, notificationType, simulate)
      logger.info(tx)
      resolve({
        success: true,
        data: tx
      })
    });
  }
}
