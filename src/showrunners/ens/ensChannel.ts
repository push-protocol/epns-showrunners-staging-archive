// @name: ENS Expiry Channel
// @version: 1.0.1
// @recent_changes: ENS Expiry Payload Fix

import { Service, Inject } from 'typedi';
import config from '../../config';
import channelWalletsInfo from '../../config/channelWalletsInfo';
import { ethers, logger} from 'ethers';
import epnsHelper, {InfuraSettings, NetWorkSettings, EPNSSettings} from '@epnsproject/backend-sdk'
const gr = require('graphql-request')
const { request, gql } = gr;

const channelKey = channelWalletsInfo.walletsKV['ensDomainExpiryPrivateKey_1']
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
const NETWORK_TO_MONITOR = config.web3RopstenNetwork;
const TRIGGER_THRESHOLD_SECS = 60 * 60 * 24 * 7; // 7 Days
const sdk = new epnsHelper(NETWORK_TO_MONITOR, channelKey, settings, epnsSettings)

@Service()
export default class EnsExpirationChannel {

  // To form and write to smart contract
  public async sendMessageToContract(simulate) {
    try{
      logger.debug(`[${new Date(Date.now())}]-[ENS]-Checking for expired address... `);
      // Call Helper function to get interactableContracts
      const ens = await sdk.getContract(config.ensDeployedContract, config.ensDeployedContractABI)

      const users = await sdk.getSubscribedUsers()
      const promises = users.map(user => this.checkENSDomainExpiry(NETWORK_TO_MONITOR, ens, user, TRIGGER_THRESHOLD_SECS, simulate))
      return await Promise.all(promises)
    } catch (error) {
      logger.makeError(`[${new Date(Date.now())}]-[ENS]-Error occurred sending transactions: `, error);
    }
  }

  // To Check for domain expiry
  public async checkENSDomainExpiry(networkToMonitor, ens, userAddress, triggerThresholdInSecs, simulate) {
    //simulate object settings START
    const logicOverride = typeof simulate == 'object' ? ((simulate.hasOwnProperty("logicOverride") && simulate.logicOverride.mode) ? simulate.logicOverride.mode : false) : false;
    const simulateENSNetwork = logicOverride && simulate.logicOverride.hasOwnProperty("ENSNetwork") ? simulate.logicOverride.ENSNetwork : false;
    const simulateApplyToAddr = logicOverride && simulate.logicOverride.hasOwnProperty("applyToAddr") ? simulate.logicOverride.applyToAddr : false;
    if(!ens){
      if(simulateENSNetwork){
        ens = sdk.advanced.getInteractableContracts(simulateENSNetwork, settings, channelKey, config.ensDeployedContract, config.ensDeployedContractABI);
      }
      else{
        ens = await sdk.getContract(config.ensDeployedContract, config.ensDeployedContractABI)
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
    //simulate object settings END

    return new Promise(async (resolve) => {

      const ensRoute = "subgraphs/name/dev-cnote/ens"
      const ENS_URL = `${config.ensEndpoint}${ensRoute}`;
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
        const result =  await this.getDomain(loop,data,address,ENS_URL,ens,triggerThresholdInSecs,networkToMonitor,simulate)
        if(result.flag){
          // logic loop, it has 7 days or less to expire but not expired
          resolve (this.getENSDomainExpiryPayload(userAddress, result.ensAddressName, result.dateDiff, simulate))
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

  public async getDomain(loop,data,address,ENS_URL,ens,triggerThresholdInSecs,networkToMonitor,simulate) {

    if(!ens){
      logger.debug("ENS Interactable Contract not set... mostly coming from routes, setting contract for --> %s", networkToMonitor);
      ens = await sdk.getContract(config.ensDeployedContract, config.ensDeployedContractABI)
    }

    if(!data){
      data = await this.getData(address,ENS_URL);
      loop = data.registrations.length
    }

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

	public async getENSDomainExpiryPayload(userAddress, ensAddressName, dateDiff, simulate) {
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
          payloadMsg = "[d subscriber your domains:" + ensAddressName + "] are set to expire in " + numOfDays + " days, tap me to renew it! [timestamp: " + Math.floor(new Date() / 1000) + "]";
        }
        else{
          message = ensAddressName + " is set to expire in " + numOfDays + " days";
          payloadMsg = "[d:" + ensAddressName + "] is set to expire in " + numOfDays + " days, tap me to renew it! [timestamp: " + Math.floor(new Date() / 1000) + "]";
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
