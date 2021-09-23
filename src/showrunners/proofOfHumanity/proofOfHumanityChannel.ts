import { Inject, Service } from 'typedi';
import config from '../../config';
import showrunnersHelper from '../../helpers/showrunnersHelper';
import { request, gql } from 'graphql-request';
import proofOfHumanitySettings from './proofOfHumanitySettings.json';
import proofOfHumanityABI from './proofOfHumanity.json';
import epnsHelper, { InfuraSettings, NetWorkSettings, EPNSSettings } from '@epnsproject/backend-sdk-staging';

import { Contract } from '@ethersproject/contracts';
import { BaseProvider } from '@ethersproject/providers';
import { reduceRight } from 'lodash';
import { SubmissionModel } from './proofOfHumanityModel';

interface Challenge {
  reason: string;
  id: string;
  creationTime: string;
  challenger: string;
  requestor: string;
}

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

interface POHContractState {
  submissionDuration: any;
}

interface Evidence {
  id: string;
  creationTime: string;
  URI: string;
  sender: string;
  request: Request;
}

interface Request {
  submission: Submission;
  id: string;
  type: string;
  requestor: string;
  arbitrator: string;
}

export interface Submission {
  id: string;
  submissionTime: number;
  creationTime: number;
  name: string;
  registered: boolean;
  status: string;
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
export default class ProofOfHumanityChannel {
  GRAPH_URL = 'https://api.thegraph.com/subgraphs/name/kleros/proof-of-humanity-mainnet';

  newChallengesQuery(hours = 21600) {
    return gql`
      {
        challenges(where: { creationTime_gte: ${(Date.now() / 1000 - hours).toFixed()} }) {
          reason
          id
          creationTime
          requester
          challenger
        }
      }
    `;
  }

  getEvidenceQuery(hours = 21600) {
    return gql`
    {
      evidences(where:{creationTime_gte:${(Date.now() / 1000 - hours).toFixed()} }){
        creationTime
        request{
          id
          submission{
            id
            name
            submissionTime
          }
          requester
          type
          arbitrator
        }
        id
        URI
        sender
      }
      }
      
    `;
  }

  getSubmissionQuery(id: string) {
    return gql`
    {
      submission(id:${id}){
        creationTime
        id
        status
        registered
        submissionTime
        name
      }
    }
  `;
  }

  get contractQuery() {
    return gql`
      {
        contracts {
          submissionDuration
        }
      }
    `;
  }

  profileQueryById(id: string) {
    return gql`{
      submission(id:"${id}"){
          id
          submissionTime
          creationTime
          status
          registered
          name
        }
    }`;
  }

  constructor(@Inject('logger') private logger, @Inject('cached') private cached) {}

  public async checkChallenges(simulate) {
    let challenges = await this.fetchRecentChallenges();

    if (!challenges || challenges.length == 0) {
      console.log(this.getLog('No challenges in this time period'));
      return;
    }

    const walletKey = await this.getWalletKey();
    const sdk: epnsHelper = new epnsHelper(config.web3MainnetNetwork, walletKey, settings, epnsSettings);
    const epns = sdk.advanced.getInteractableContracts(
      config.web3RopstenNetwork,
      settings,
      walletKey,
      config.deployedContract,
      config.deployedContractABI,
    );
    this.logger.info(this.getLog('Fetching subscribed users'));
    const users = await sdk.getSubscribedUsers();
    this.logger.info('Finished fetching subscribed users');

    this.logger.info('Sending out notifications');

    challenges.map(async e => {
      try {
        if (users.includes(e.requestor)) {
          const message = `Your profile has been challenged by ${e.challenger}`;
          await this.prepareAndSendNotification(sdk, epns, simulate, {
            recipientAddr: e.requestor,
            title: 'New Challenge',
            payloadTitle: 'New Challenge',
            body: message,
            payloadMsg: message,
            payloadCTA: 'https://proofofhumanity.id',
            payloadImg: '',
            payloadType: 3,
          });
        }
      } catch (error) {
        this.logger.error(error);
      }
    });
  }

  public async removalRequestTask(simulate) {

    const logger = this.logger;
    logger.info(this.getLog('Removal Request Task'));
    const helpers = await this.getHelpers(simulate);

    const sdk: epnsHelper = helpers.sdk;
    const epns = helpers.epns;

    let poh = helpers.poh;

    let removalRequests = await this.fetchRecentRemovalRequests(poh, helpers.fromBlock, helpers.toBlock);

    const users = await sdk.getSubscribedUsers();
    removalRequests.log.forEach(async e => {
      if (users.includes(e.args[1])) {
        const title = 'Removal Request';
        const msg = `A removal request has been submitted by ${e.args[0]} for your profile`;
        await this.prepareAndSendNotification(sdk, epns, simulate, {
          recipientAddr: e.args[1],
          payloadType: 3,
          title: title,
          body: msg,
          payloadTitle: title,
          payloadMsg: msg,
          payloadCTA: 'https://proofofhumanity.id',
          payloadImg: null,
        });
      }
    });

    logger.info(this.getLog('Finished sending notifications'));
    logger.info(this.getLog('Setting upgraded block_number in cache'));
    this.cached.setCache(BLOCK_NUMBER, helpers.toBlock);
  }

  // Checks for profile Expiration and Sends notification to users
  // Whose Profile is about to be expired
  async checkForExpiration(simulate) {
    let meta = await this.getSdks();

    this.logger.info(this.getLog('getting submission duration'));
    let submissionDuration = (await this.fetchContractDetails()).submissionDuration;
    this.logger.info(`submission duration : ${submissionDuration}`);

    this.logger.info('getting subscribed users');
    let users = await meta.sdk.getSubscribedUsers();

    this.logger.info('sending out notifications');
    await users.forEach(async u => {
      try {
        let profile = await this.fetchProfileDataById(u);
        if (profile && profile.submissionTime + submissionDuration < (Date.now() / 1000 - 86400).toFixed()) {
          const title = 'Profile Expiry';
          const msg = 'Your profile is about to expire in 1 day';
          this.prepareAndSendNotification(meta.sdk, meta.epns, simulate, {
            recipientAddr: u,
            payloadType: 3,
            title: title,
            body: msg,
            payloadCTA: 'https://proofofhumanity.id',
            payloadImg: null,
            payloadMsg: msg,
            payloadTitle: title,
          });
        }
      } catch (error) {
        this.logger.error(this.getLog(error));
      }
    });
    this.logger.info(this.getLog('Expiration task completed'));
    return { success: true };
  }

  // Check if profiles are accepted
  //
  async checkForAcceptedProfiles(simulate) {
    let meta = await this.getSdks();

    this.logger.info(this.getLog('getting submission duration'));
    let submissionDuration = (await this.fetchContractDetails()).submissionDuration;
    this.logger.info(`submission duration : ${submissionDuration}`);

    this.logger.info('getting subscribed users');
    let users = await meta.sdk.getSubscribedUsers();

    this.logger.info('sending out notifications');
    await users.forEach(async u => {
      try {
        let profile = await this.fetchProfileDataById(u);
        this.logger.info(profile);

        if (profile) {
          // Fetching profile data of user from DB
          this.logger.info(this.getLog('Fetching Profile Data Of User From DB'));
          let profileFromDb = await SubmissionModel.findOneAndUpdate({ _id: u }, profile, { upsert: true });
          this.logger.info(profileFromDb ?? 'Profile Not In DB');
          const userRegisteredAndInsideSubmissionPeriod =
            (Date.now() / 1000 - profile.submissionTime).toFixed() < submissionDuration && profile.registered;
          const stateChanged: boolean = profileFromDb && !profileFromDb.registered;
          this.logger.info(
            this.getLog(
              `userRegisteredAndInsideSubmissionPeriod : ${userRegisteredAndInsideSubmissionPeriod} stateChanged: ${stateChanged}`,
            ),
          );
          if (userRegisteredAndInsideSubmissionPeriod && !stateChanged) {
            this.logger.info(this.getLog('Sending Notification'));
            const title = 'Profile Accepted';
            const msg = 'Your profile has been accepted';
            this.prepareAndSendNotification(meta.sdk, meta.epns, simulate, {
              recipientAddr: u,
              payloadType: 3,
              title: title,
              body: msg,
              payloadCTA: 'https://proofofhumanity.id',
              payloadImg: null,
              payloadMsg: msg,
              payloadTitle: title,
            });
          }
        }else{
          this.logger.info("User dont have a profile Aborting..") 
        }
      } catch (error) {
        this.logger.error(this.getLog(error));
      }
    });
    this.logger.info(this.getLog('Expiration task completed'));
    return { success: true };
  }

  // Checks for profile Expiration and Sends notification to users
  // Whose Profile is about to be expired
  async checkRecentEvidences(simulate) {
    let helpers = await this.getSdks();
    this.logger.info(this.getLog('Check recent evidences'));
    try {
      let evidences = await this.fetchEvidences();
      evidences.forEach(async e => {
        let title = 'New Evidence Submitted';
        let msg = 'New evidence has been submitted for a request you are involved';

        this.logger.info(this.getLog('Sending notification to evidence provider'));

        // Notificatin to the evidence sender
        await this.prepareAndSendNotification(helpers.sdk, helpers.epns, simulate, {
          recipientAddr: e.sender,
          title: title,
          body: msg,
          payloadTitle: title,
          payloadMsg: title,
          payloadType: 3,
          payloadCTA: 'https://proofofhumanity.id',
          payloadImg: null,
        });

        this.logger.info(this.getLog('Sending notification to requestor'));

        // Notificatin to the requestor
        await this.prepareAndSendNotification(helpers.sdk, helpers.epns, simulate, {
          recipientAddr: e.request.requestor,
          title: title,
          body: msg,
          payloadTitle: title,
          payloadMsg: title,
          payloadType: 3,
          payloadCTA: 'https://proofofhumanity.id',
          payloadImg: null,
        });

        this.logger.info(this.getLog('Sending notification to submission owner'));
        // Notificatin to the submission owner
        await this.prepareAndSendNotification(helpers.sdk, helpers.epns, simulate, {
          recipientAddr: e.request.submission.id,
          title: title,
          body: msg,
          payloadTitle: title,
          payloadMsg: title,
          payloadType: 3,
          payloadCTA: 'https://proofofhumanity.id',
          payloadImg: null,
        });
      });
    } catch (error) {
      this.logger.error(this.getLog(error));
      return { success: false };
    }

    return { success: true };
  }

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

  getLog(inp: string) {
    return `[${new Date(Date.now())}]-[ProofOfHumanity]- ` + inp;
  }

  async getHelpers(simulate) {
    let sdks = await this.getSdks();
    let sdk = sdks.sdk;
    let poh = await sdk.getContract(
      proofOfHumanitySettings.proofOfHumanityDeployedContract,
      JSON.stringify(proofOfHumanityABI),
    );

    const logicOverride =
      typeof simulate == 'object'
        ? simulate.hasOwnProperty('logicOverride') && simulate.logicOverride.mode
          ? simulate.logicOverride.mode
          : false
        : false;

    // Initailize block if it is missing
    let cachedBlock = (await this.cached.getCache(BLOCK_NUMBER)) ?? 0;
    this.logger.info(this.getLog(`Cached block ${cachedBlock}`));
    let blockNumber = await poh.provider.getBlockNumber();
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
        : await poh.provider.getBlockNumber();

    return {
      logicOverride: logicOverride,
      fromBlock: fromBlock,
      toBlock: toBlock,
      sdk: sdk,
      epns: sdks.epns,
      poh: poh,
    };
  }

  async getSdks() {
    this.logger.info(this.getLog('getSdksHelper called'));
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
      3,
      1,
      ipfsHash,
      0,
      this.logger,
      simulate,
    );
  }

  //
  //
  // FETCH TASKS
  //
  //

  // Fetches the recent challenge in the nearest time frame from POH subgraph
  //
  async fetchRecentChallenges(): Promise<Challenge[]> {
    this.logger.info(this.getLog(`Fetching Recent Challenges`));
    let result = await request(this.GRAPH_URL, this.newChallengesQuery());
    return result.challenges;
  }

  // Fetch contract state from subgraph
  async fetchContractDetails(): Promise<POHContractState> {
    this.logger.info(this.getLog(`Fetching Contract State`));
    let result = await request(this.GRAPH_URL, this.contractQuery);
    this.logger.info(
      this.getLog(`Contract state fetched 
`),
    );

    this.logger.info(result);

    return result['contracts'][0];
  }

  // Get data of a submission
  async fetchProfileDataById(id: string): Promise<Submission> {
    this.logger.info(this.getLog(`Fetching Profile Data for user ${id}`));
    let result;
    try {
      result = await request(this.GRAPH_URL, this.profileQueryById(id));
      this.logger.info(result?.submission ?? 'The user dont have a profile');
    } catch (error) {
      this.logger.error(this.getLog(error));
    }

    return result?.submission;
  }

  // Fetch recent removal requests in a givern time period
  async fetchRecentRemovalRequests(
    poh: {
      provider: BaseProvider;
      contract: Contract;
      signingContract: Contract;
    },
    fromBlock,
    toBlock,
  ) {
  

    const filter = poh.contract.filters.RemoveSubmission();
    try {
      this.logger.info(this.getLog(`Fetching Recent Removal Requests fromBlock : ${fromBlock} toBlock: ${toBlock}`));
      const events = await poh.contract.queryFilter(filter, fromBlock, toBlock);
      this.logger.info(this.getLog('Events Fetched Successfully'));
      this.cached.setCache(BLOCK_NUMBER, toBlock + 1);
      return {
        change: true,
        log: events,
        blockChecker: fromBlock,
        lastBlock: toBlock,
        eventCount: events,
      };
    } catch (err) {
      this.logger.error(this.getLog(err));
      return {
        success: false,
        err: 'Unable to obtain query filter, error : %o' + err,
      };
    }
  }

  // Fetch Evidence from subgraph
  //
  async fetchEvidences(): Promise<Evidence[]> {
    this.logger.info(this.getLog('Fetching evidences from subgraph'));
    let result;
    try {
      result = await request(this.GRAPH_URL, this.getEvidenceQuery());
    } catch (error) {
      this.logger.error(this.getLog(error));
      console.log(error);
    }

    return result?.evidences;
  }

  // Fetch Evidence from subgraph
  //
  async fetchSubmission(id: string): Promise<Evidence[]> {
    this.logger.info(this.getLog('Fetching evidences from subgraph'));
    let result;
    try {
      result = await request(this.GRAPH_URL, this.getSubmissionQuery(id));
    } catch (error) {
      this.logger.error(this.getLog(error));
      throw error;
    }

    return result.evidences;
  }
}
