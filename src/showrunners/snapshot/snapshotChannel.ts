// @name: Snapshot Channel
// @version: 1.0
// @recent_changes: Changed Logic to be modular

import { Service, Inject, Container } from 'typedi';
import config from '../../config';
import showrunnersHelper from '../../helpers/showrunnersHelper';
import { ethers, logger } from 'ethers';
import epnsHelper, { InfuraSettings, NetWorkSettings, EPNSSettings } from '@epnsproject/backend-sdk-staging'
import moment from "moment"
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

@Service()
export default class snapshotChannel {
  constructor(

    @Inject('logger') private logger,
  ) {
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
  URL_SPACE_PROPOSAL = "https://hub.snapshot.org/graphql"
  URL_DELEGATE = "https://api.thegraph.com/subgraphs/name/snapshot-labs/snapshot"
  DelegateSnapshot: any;

  public async sendMessageToContract(simulate) {
    logger.debug(`[${new Date(Date.now())}]-[Snapshot]- Checking for new proposals...`);
    // Overide logic if need be
    const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") && simulate.logicOverride.mode ? simulate.logicOverride.mode : false) : false;
    const simulateDelegateAddr = logicOverride && simulate.logicOverride.hasOwnProperty("delegateAddr") ? simulate.logicOverride.delegateAddr : false;
    // -- End Override logic

    let proposals = await this.fetchProposalHelperFunction();
    if (Object.keys(proposals).length === 0) {
      logger.info(`[${new Date(Date.now())}]-[Snapshot]- No Proposals in past 3 hours`)
      return
    }

    if (simulateDelegateAddr) {
      await this.processAndSendNotification(proposals, simulateDelegateAddr, simulate);
      return

    }

    //Fetch global delegates and see if it is empty or not
    let globalDelegates = await this.fecthDelegateFromDB("global")
    if (simulate.hasOwnProperty("delegateAddr"))
      if (globalDelegates.length === 0) {
        logger.info(`[${new Date(Date.now())}]-[Snapshot]- Delegates are not yet saved; fetching from API...`)
        await this.fetchDelegateAndSaveToDB()
      }

    //Send payload to delegates
    await this.processAndSendNotification(proposals, globalDelegates, simulate);

    logger.info(`[${new Date(Date.now())}]-[Snapshot]- Completed sending notification`)

  }

  public async processAndSendNotification(proposal, globalDelegates, simulate) {
    const spaces = Object.keys(proposal);
    const walletKey = await this.getWalletKey()
    const sdk = new epnsHelper(config.web3MainnetNetwork, walletKey, settings, epnsSettings);
    const epns = sdk.advanced.getInteractableContracts(epnsSettings.network, settings, walletKey, epnsSettings.contractAddress, epnsSettings.contractABI)
    logger.info(spaces)
    for (let i = 0; i < spaces.length; i++) {
      logger.info(`[${new Date(Date.now())}]-[Snapshot]- Preparing to send notification for ${spaces[i]}`)
      for (let j = 0; j < proposal[spaces[i]].length; j++) {
        logger.info(proposal[spaces[i]][j].title)
        const title = `New Proposal is live in ${spaces[i]}`
        const message = `Title:${proposal[spaces[i]][j].title}\nStart Date:${moment((proposal[spaces[i]][j].start) * 1000).format("MMMM Do YYYY")}\nEnd Date:${moment((proposal[spaces[i]][j].end) * 1000).format("MMMM Do YYYY")}`
        const payloadTitle = `New Proposal is live in ${spaces[i]}`;
        const payloadMsg = `[d:Title] : ${proposal[spaces[i]][j].title}\n[s:Start Date] : ${moment((proposal[spaces[i]][j].start) * 1000).format("MMMM Do YYYY")}\n[t:End Date] : ${moment((proposal[spaces[i]][j].end) * 1000).format("MMMM Do YYYY")} [timestamp: ${Math.floor(new Date() / 1000)}]`;
        const notificationType = 3;
        const delegates: any = await this.fecthDelegateFromDB(spaces[i]);
        const cta: any = `https://snapshot.org/#/${spaces[i]}/proposal/${proposal[spaces[i]][j].id}`
        console.log(cta)
        const storageType = 1;
        const trxConfirmWait = 0;
        if (!simulate) {
          for (let k = 0; k < globalDelegates.length; k++) {
            const payload = await sdk.advanced.preparePayload(globalDelegates[k].delegate, notificationType, title, message, payloadTitle, payloadMsg, cta, null)
            const ipfsHash = await sdk.advanced.uploadToIPFS(payload, logger, null, simulate)
            const tx = await sdk.advanced.sendNotification(epns.signingContract, globalDelegates[k].delegate, notificationType, storageType, ipfsHash, trxConfirmWait, logger, simulate)
            logger.info(tx);
          }

          for (let k = 0; k < delegates.length; k++) {
            const payload = await sdk.advanced.preparePayload(delegates[k].delegate, notificationType, title, message, payloadTitle, payloadMsg, cta, null)
            const ipfsHash = await sdk.advanced.uploadToIPFS(payload, logger, null, simulate)
            const tx = await sdk.advanced.sendNotification(epns.signingContract, delegates[k].delegate, notificationType, storageType, ipfsHash, trxConfirmWait, logger, simulate)
            logger.info(tx);
          }
        }
        else {
          const payload = await sdk.advanced.preparePayload(simulate.delegateAddr, notificationType, title, message, payloadTitle, payloadMsg, cta, null)
          const ipfsHash = await sdk.advanced.uploadToIPFS(payload, logger, null, simulate)
          const tx = await sdk.advanced.sendNotification(epns.signingContract, simulate.delegateAddr, notificationType, storageType, ipfsHash, trxConfirmWait, logger, simulate)

          // const tx = await sdk.sendNotification(globalDelegates[k].delegate, title, message, payloadTitle, payloadMsg, notificationType, simulate)
          logger.info(tx);

        }
      }
    }

  }
  //Fetch Space Details
  public async fetchSpaceDetails() {
    logger.info(`[${new Date(Date.now())}]-[Snapshot]- Fetching space details`)
    const spaceQuery = gql`{
        spaces(
          first: 1000,
          skip: 0,
          orderBy: "network",
          orderDirection: asc
        ) {
          id
          name
          symbol
          network
        }
      }`

    const spaces = await request(this.URL_SPACE_PROPOSAL, spaceQuery)
    console.log(spaces)
    let ethSpaces = spaces.spaces.filter(ele => ele.network == 1)
    return ethSpaces
  }

  //Helper function to fetch proposals of each space
  public async fetchProposalHelperFunction() {
    const spaces = await this.fetchSpaceDetails();
    let res = {};

    for (let i = 0; i < spaces.length; i++) {
      const proposal = await this.fetchProposalDetails(spaces[i]);
      if (proposal.success && proposal.data.length != 0)
        res[spaces[i].id] = proposal.data
    }
    return res;
  }

  //Function to fetch proposal details
  public fetchProposalDetails(spaceData: any) {
    // logger.info(`[${new Date(Date.now())}]-[Snapshot]- Fetching Proposals for ${spaceData.id}`)
    //3600000 for 3 hr
    return request(this.URL_SPACE_PROPOSAL,
      gql`{
          proposals (
            skip: 0,
            where: {
              space_in: ["${spaceData.id}"],
              state: "active",
              created_gte:${Math.floor((Date.now() - 10800000) / 1000)}
            },
            orderBy: "created",
            orderDirection: desc
          ) {
            id
            title
            start
            end
            space {
              id
              name
            }
          }
        }`

    ).then(function (response) {
      console.log(response)
      return {
        success: true,
        data: response.proposals
      };
    })
      .catch(function (error) {
        return { success: false, error: error };
      });
  }

  public async fetchDelegateAndSaveToDB() {
    logger.info(`[${new Date(Date.now())}]-[Snapshot]- Delegates Saving to DB`)
    const space = await this.fetchSpaceDetails();
    const res = []
    const allDelegates = await this.fetchDelegateHelperFunction(space)
    for (let item in allDelegates) {
      // logger.info(`[${new Date(Date.now())}]-[Snapshot]- Delegates of ${item} of ${Object.values(allDelegates).length}`)
      for (let i = 0; i < allDelegates[item].length; i++) {
        const res = await this.saveSingleDelegateDB(allDelegates[item][i].delegate, allDelegates[item][i].space == "" ? "global" : allDelegates[item][i].space)
        logger.info(`[${new Date(Date.now())}]-[Snapshot]- Delegates saved ${i} of ${allDelegates[item].length}`)
      }
    }
    return { status: "success" }
  }
  //Helper function to fetch delegates of each space
  public async fetchDelegateHelperFunction(spaces: any) {

    let res = {};
    for (let i = 0; i < spaces.length; i++) {
      // logger.info(`[${new Date(Date.now())}]-[Snapshot]- Fetching delegates for ${spaces[i].id}`)
      const delegates = await this.fetchDelegateDetails(spaces[i]);
      if (delegates.success && delegates.data.length != 0)
        res[spaces[i].id] = delegates.data
    }
    const globalDelegates = await this.fetchDelegateDetails("");
    res["global"] = globalDelegates.data;
    return res;
  }
  //Function to fetch delegate details
  public fetchDelegateDetails(spaceData: any) {
    const dquery = gql`{
 
      delegations(first:1000,where:{space:"${spaceData == "" ? "" : spaceData.id}"}) {
        id
        delegator
        space
        delegate
      }
    }`
    return request(this.URL_DELEGATE, dquery)
      .then((response) => {
        return {
          success: true,
          data: response.delegations
        }
      })
      .catch((error) => {
        return { success: false, error: error }
      })

  }

  //Mongo functions to save multiple delegate

  public async saveArrayOfDelegateDB(data): Promise<{}> {

    this.DelegateSnapshot = Container.get('snapshotModel');
    try {
      const multipleDelegate = await this.DelegateSnapshot.insertMany(data);
      return multipleDelegate;
    }
    catch (error) {
      logger.info(`[${new Date(Date.now())}]-[Snapshot]- error while creating multiple delegate at saveArrayOfDelegateDB Error: %o`, error);
    }
  }

  //Mongo function to save single delegate

  public async saveSingleDelegateDB(delegate, space): Promise<{}> {
    this.DelegateSnapshot = Container.get('snapshotModel');
    let singleDelegate;
    try {

      singleDelegate = this.DelegateSnapshot.updateOne({ delegate, space }, { $set: { delegate, space } }, { upsert: true });
      return singleDelegate;
    }
    catch (error) {
      logger.info(`[${new Date(Date.now())}]-[Snapshot]- error while creating record at saveSingleDelegateDB Error: %o`, error);

    }

  }

  //Mongo function to send all delegate details

  public async fetchAllDelegateFromDB(): Promise<[]> {
    this.DelegateSnapshot = Container.get('snapshotModel')
    try {
      const allDelegate = await this.DelegateSnapshot.find({});
      return allDelegate;
    }
    catch (error) {
      logger.info(`[${new Date(Date.now())}]-[Snapshot]- error while fetching delegate details Error: %o`, error);
    }
  }

  //Mongo function to fetch specific delegates

  public async fecthDelegateFromDB(space): Promise<[]> {
    this.DelegateSnapshot = Container.get('snapshotModel')
    try {
      const delegates = await this.DelegateSnapshot.find({ space: space })
      return delegates
    }
    catch (error) {
      logger.info(`[${new Date(Date.now())}]-[Snapshot]- error while fetching specific delegate details Error: %o`, error);

    }

  }
}