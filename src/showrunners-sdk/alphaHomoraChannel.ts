// @name: AlphaHomora Channel
// @version: 1.0

import { Service, Inject } from 'typedi';
import config from '../config';
import channelWalletsInfo from '../config/channelWalletsInfo';
// import PQueue from 'p-queue';
import { ethers, logger } from 'ethers';
// import epnsHelper, {InfuraSettings, NetWorkSettings, EPNSSettings} from '@epnsproject/backend-sdk-staging'
import epnsHelper, { InfuraSettings, NetWorkSettings, EPNSSettings } from '../../../epns-backend-sdk-staging/src'
// const queue = new PQueue();
const channelKey = channelWalletsInfo.walletsKV['alphahomoraPrivateKey_1']

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
const sdk = new epnsHelper(config.web3MainnetNetwork, channelKey, settings, epnsSettings)

@Service()
export default class AlphaHomoraChannel {
  // To form and write to smart contract
  public async sendMessageToContract(simulate) {
    const users = await sdk.getSubscribedUsers()
    const AlphaHomoraContract = await sdk.getContract(config.homoraBankDeployedContract, config.homoraBankDeployedContractABI)
    let next_pos = await AlphaHomoraContract.contract.functions.nextPositionId()
    next_pos = Number(next_pos.toString())
    logger.info({ next_pos })
    const epns = sdk.advanced.getInteractableContracts(epnsSettings.network, settings, channelKey, epnsSettings.contractAddress, epnsSettings.contractABI)
    for (let i = 1; i < next_pos; i++) {
      console.log(i)
      if(i!=6)
      await this.processDebtRatio(users, i, AlphaHomoraContract.contract,epns, simulate); }
  }

  public async processDebtRatio(users: Array<string>, id: number, contract,epns, simulate: boolean | Object) {
    const position = await contract.functions.getPositionInfo(id)
    logger.info({ position: position.owner })
    if (users.includes(position.owner)) { }
    let [borrowCredit, collateralCredit] = await Promise.all([contract.functions.getBorrowETHValue(id), contract.functions.getCollateralETHValue(id)]);
    borrowCredit = Number(ethers.utils.formatEther(borrowCredit[0]))
    collateralCredit = Number(ethers.utils.formatEther(collateralCredit[0]))
    const debtRatio = (borrowCredit / collateralCredit) * 100
    logger.info({ debtRatio })

    if (debtRatio > Number(config.homoraDebtRatioThreshold)) {
      const title = `Position Liquidation`
      const message = `Your position of id: ${id} is at ${debtRatio}% debt ratio and is at risk of liquidation`
      const payloadTitle = `Position Liquidation`;
      const payloadMsg = `Your position of id: ${id} is at ${debtRatio}% debt ratio and is at risk of liquidation. [timestamp: ${Math.floor(new Date() / 1000)}]`;
      const user: any = position.owner;
      const cta: any = `https://alphafinance.io/`
      const notificationType = 3;
      const storageType = 1;
      const trxConfirmWait = 0;
      const payload = await sdk.advanced.preparePayload(user, notificationType, title, message, payloadTitle, payloadMsg, cta, null)
      const ipfsHash = await sdk.advanced.uploadToIPFS(payload, logger, null, simulate)
      const tx = await sdk.advanced.sendNotification(epns.signingContract, user, notificationType, storageType, ipfsHash, trxConfirmWait, logger, simulate)    
      // const tx = await sdk.sendNotification(
      //   position.owner,
      //   'Position Liquidation',
      //   `Your position of id: ${id} is at ${config.homoraDebtRatioThreshold}% debt ratio and is at risk of liquidation`,
      //   'Position Liquidation',
      //   `Your position of id: ${id} is at ${config.homoraDebtRatioThreshold}% debt ratio and is at risk of liquidation. [timestamp: ${Math.floor(new Date() / 1000)}]`,
      //   notificationType,
      //   simulate
      // )
      logger.info(tx)
    }
    else
      return
  }
}