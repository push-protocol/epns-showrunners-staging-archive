// @name: AlphaHomora Channel
// @version: 1.0

import { Service, Inject } from 'typedi';
import config from '../../config';
import showrunnersHelper from '../../helpers/showrunnersHelper';
// import PQueue from 'p-queue';
import { ethers, logger } from 'ethers';
import epnsHelper, { InfuraSettings, NetWorkSettings, EPNSSettings } from '@epnsproject/backend-sdk'
// const queue = new PQueue();

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
const alphaHomoraSettings = require('./alphaHomoraSettings.json')
const homoraBankDeployedContractABI = require('./HomoraBank.json')
const NETWORK_TO_MONITOR = config.web3MainnetNetwork

@Service()
export default class AlphaHomoraChannel {
  constructor(
    @Inject('logger') private logger,
  ) { }

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
    const users = await sdk.getSubscribedUsers()
    const AlphaHomoraContract = await sdk.getContract(alphaHomoraSettings.homoraBankDeployedContract, homoraBankDeployedContractABI)
    let next_pos = await AlphaHomoraContract.contract.functions.nextPositionId()
    next_pos = Number(next_pos.toString())
    logger.info({ next_pos })
    for (let i = 1; i < next_pos; i++) {
      if (i != 6)
        await this.processDebtRatio(users, i, AlphaHomoraContract.contract, simulate);
    }
  }

  public async processDebtRatio(users: Array<string>, id: number, contract, simulate: boolean | Object) {
    const walletKey = await this.getWalletKey()
    const sdk = new epnsHelper(config.web3MainnetNetwork, walletKey, settings, epnsSettings);
    const epns = sdk.advanced.getInteractableContracts(epnsSettings.network, settings, walletKey, epnsSettings.contractAddress, epnsSettings.contractABI)

    const position = await contract.functions.getPositionInfo(id)
    logger.info({ position: position.owner })
    if (users.includes(position.owner)) { }
    let [borrowCredit, collateralCredit] = await Promise.all([contract.functions.getBorrowETHValue(id), contract.functions.getCollateralETHValue(id)]);
    borrowCredit = Number(ethers.utils.formatEther(borrowCredit[0]))
    collateralCredit = Number(ethers.utils.formatEther(collateralCredit[0]))
    const debtRatio = (borrowCredit / collateralCredit) * 100
    logger.info({ debtRatio })
    if (debtRatio > Number(alphaHomoraSettings.homoraDebtRatioThreshold)) {
      const notificationType = 3;
      const title = `Position Liquidation`
      const message = `Your position of id: ${id} is at ${debtRatio}% debt ratio and is at risk of liquidation`
      const payloadTitle = `Position Liquidation`;
      const payloadMsg = `Your position of id: ${id} is at ${debtRatio}% debt ratio and is at risk of liquidation. [timestamp: ${Math.floor(new Date() / 1000)}]`;
      const user: any = position.owner;
      const cta: any = `https://alphafinance.io/`
      const storageType = 1;
      const trxConfirmWait = 0;
      const payload = await sdk.advanced.preparePayload(user, notificationType, title, message, payloadTitle, payloadMsg, cta, null)
      const ipfsHash = await sdk.advanced.uploadToIPFS(payload, logger, null, simulate)
      const tx = await sdk.advanced.sendNotification(epns.signingContract, user, notificationType, storageType, ipfsHash, trxConfirmWait, logger, simulate)

      logger.info(`[${new Date(Date.now())}]-[Alpha Homora]- transaction: %o`, tx)
    }
  }
}

