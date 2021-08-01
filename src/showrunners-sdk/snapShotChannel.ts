// @name: Snapshot Channel
// @version: 1.0
// @recent_changes: Under construction

import { Service, Inject, Container } from 'typedi';
import config from '../config';
import channelWalletsInfo from '../config/channelWalletsInfo';
// import PQueue from 'p-queue';
import { ethers, logger } from 'ethers';
import epnsHelper, { InfuraSettings, NetWorkSettings, EPNSSettings } from '@epnsproject/backend-sdk-staging'
// const queue = new PQueue();
const gr = require('graphql-request')
const { request, gql } = gr;

const channelKey = channelWalletsInfo.walletsKV['snapshotPrivateKey_1']

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
export default class SnapshotChannel {
  URL_SPACE_PROPOSAL = "https://hub.snapshot.page/graphql"
  URL_DELEGATE = "https://api.thegraph.com/subgraphs/name/snapshot-labs/snapshot"
  DelegateSnapshot: any;

  public async sendMessageToContract(simulate) {
    logger.debug(`[${new Date(Date.now())}]-[Snapshot]- Checking for new proposals...`);
    // Overide logic if need be
    const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") && simulate.logicOverride.mode ? simulate.logicOverride.mode : false) : false;
   // -- End Override logic

    
    let proposals = await this.fetchProposalHelperFunction();
    if(Object.keys(proposals).length === 0)
      {
        logger.info(`[${new Date(Date.now())}]-[Snapshot]- No Proposals in past 3 hours`)
        return
      }

    //Fetch global delegates and see if it is empty or not
    let globalDelegates = await this.fecthDelegateFromDB("")
    if (globalDelegates.length === 0) {
      logger.info(`[${new Date(Date.now())}]-[Snapshot]- Delegates are not yet saved; fetching from API...`)
      await this.fetchDelegateAndSaveToDB()
    }

    //Send payload to delegates
    await this.processAndSendNotification(proposals,globalDelegates,simulate);

    logger.info(`[${new Date(Date.now())}]-[Snapshot]- Completed sending notification`)

  }

  public async processAndSendNotification(proposal,globalDelegates,simulate) {
    const spaces = Object.keys(proposal);
    for(let i=0;i<spaces.length;i++)
    {
      logger.info(`[${new Date(Date.now())}]-[Snapshot]- Preparing to send notification for ${spaces[i]}`)
      for(let j=0;j<proposal[spaces[i]].length;j++)
      {
      const title=`New Proposal is live in ${spaces[i]}`
      const message = `${proposal[spaces[i]][j].title}`
      const payloadTitle = `New Proposal is live in ${spaces[i]}`;
      const payloadMsg = `${proposal[spaces[i]][j].title}`;
      const notificationType = 3;
      const delegates:any = await this.fecthDelegateFromDB(spaces[i]);
        for(let k=0;k<globalDelegates.length;k++)
        {
          const tx = await sdk.sendNotification(globalDelegates[k].delegate, title, message, payloadTitle, payloadMsg, notificationType, simulate)
          logger.info(tx);
        }

        for(let k=0;k<delegates.length;k++)
        {
          const tx = await sdk.sendNotification(delegates[k].delegate, title, message, payloadTitle, payloadMsg, notificationType, simulate)
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
          first: 10,
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
    logger.info(`[${new Date(Date.now())}]-[Snapshot]- Fetching Proposals for ${spaceData.id}`)
    return request(this.URL_SPACE_PROPOSAL,
      gql`{
          proposals (
            skip: 0,
            where: {
              space_in: ["${spaceData.id}"],
              state: "active",
              created_gte:${Math.floor((Date.now() - 9000000) / 1000)}
            },
            orderBy: "created",
            orderDirection: desc
          ) {
            id
            title
            space {
              id
              name
            }
          }
        }`

    ).then(function (response) {
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
      logger.info(`[${new Date(Date.now())}]-[Snapshot]- Delegates of ${item} of ${Object.values(allDelegates).length}`)
      for (let i = 0; i < allDelegates[item].length; i++) {
        const res = await this.saveSingleDelegateDB(allDelegates[item][i].delegate, allDelegates[item][i].space == "" ? "global" : allDelegates[item][i].space)
        logger.info(`[${new Date(Date.now())}]-[Snapshot]- Delegates saved ${i} of ${allDelegates[item].length}`)
      }
    }
    return {status: "success"}
  }

  //Helper function to fetch delegates of each space
  public async fetchDelegateHelperFunction(spaces: any) {
    
    let res = {};
    for (let i = 0; i < spaces.length; i++) {
      logger.info(`[${new Date(Date.now())}]-[Snapshot]- Fetching delegates for ${spaces[i].id}`)
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

    this.DelegateSnapshot = Container.get('DelegateSnapshotModel');
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
    this.DelegateSnapshot = Container.get('DelegateSnapshotModel');
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
    this.DelegateSnapshot = Container.get('DelegateSnapshotModel')
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
    this.DelegateSnapshot = Container.get('DelegateSnapshotModel')
    try {
      const delegates = await this.DelegateSnapshot.find({ space: space })
      return delegates
    }
    catch (error) {
      logger.info(`[${new Date(Date.now())}]-[Snapshot]- error while fetching specific delegate details Error: %o`, error);

    }

  }

}