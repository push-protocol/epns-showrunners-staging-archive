// @name: TracerDAO Channel
// @version: 1.0
// @recent_changes: Changed Logic to be modular

import { Service, Inject, Container } from 'typedi';
import config from '../../config';
import showrunnersHelper from '../../helpers/showrunnersHelper';
import { ethers, logger } from 'ethers';
import epnsHelper, { InfuraSettings, NetWorkSettings, EPNSSettings } from '@epnsproject/backend-sdk'
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

const NOTIFICATION_TYPE = Object.freeze({
    NEW: "new_proposal",
    STATUS: "passed_or_not",
});

@Service()
export default class TracerDAOChannel {
    URL_SPACE_PROPOSAL = "https://hub.snapshot.org/graphql"
    URL_DELEGATE = "api.thegraph.com/subgraphs/name/snapshot-labs/snapshot"
    NEW_PROPOSAL_QUERY = gql`{
        proposals (
          skip: 0,
          where: {
            space_in: ["tracer.eth"],
            end_lte:1629380490,
            end_gte:1629341000
          },
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

    ENDED_PROPOSAL_QUERY = gql`{
        proposals(
          first: 20,
          skip: 0,
          where: {
            space_in: ["tracer.eth"],
            end_lte:1629380490,
            end_gte:1629341000
            
          },
          
        ) {
          id
          title
          choices
        }
      }`
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

    public async sendMessageToContract(simulate) {
        logger.debug(`[${new Date(Date.now())}]-[TrackerDAO]- Checking for new proposals...`);
        // Overide logic if need be
        const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") && simulate.logicOverride.mode ? simulate.logicOverride.mode : false) : false;
        // -- End Override logic

        let proposals = await this.fetchNewProposalDetails();
        console.log(proposals.data)
        if (proposals.data.length === 0) {
            logger.info(`[${new Date(Date.now())}]-[TrackerDAO]- No Proposals in past 3 hours`)
            return
        }
        const walletKey = await this.getWalletKey()
        const sdk = new epnsHelper(config.web3MainnetNetwork, walletKey, settings, epnsSettings);
        const epns = sdk.advanced.getInteractableContracts(config.web3RopstenNetwork, settings, walletKey, config.deployedContract, config.deployedContractABI);
        const users = await sdk.getSubscribedUsers()
        users.map(async (userAddress) => {
            // Get user address
            // const userAddress = log.args.user;
            await this.processAndSendNotification(proposals.data, userAddress, NOTIFICATION_TYPE.NEW, sdk, epns, simulate)
        })
        logger.info(`[${new Date(Date.now())}]-[TrackerDAO]- Completed sending notification`)

    }

    public async fetchRecentlyEndedProposals() {
        logger.info(`[${new Date(Date.now())}]-[TrackerDAO]- Fetching Finished Proposals`)
        return request(this.URL_SPACE_PROPOSAL, this.ENDED_PROPOSAL_QUERY).then(function (response) {
            return {
                success: true,
                data: response.proposals
            };
        })
            .catch(function (error) {
                return { success: false, error: error };
            });

    }

    public async fetchVotesForFinsihedProposal(simulate) {
        logger.info(`[${new Date(Date.now())}]-[TrackerDAO]- Fetching Votes Finished Proposals`)
        const finished = await this.fetchRecentlyEndedProposals();
        console.log(finished.data)
        const walletKey = await this.getWalletKey()
        const sdk = new epnsHelper(config.web3MainnetNetwork, walletKey, settings, epnsSettings);
        const epns = sdk.advanced.getInteractableContracts(config.web3RopstenNetwork, settings, walletKey, config.deployedContract, config.deployedContractABI);
        const users = await sdk.getSubscribedUsers()
        console.log(users)

        for (let i = 0; i < finished.data.length; i++) {
            let voteQuery = `{
                votes (
                  first: 1000
                  where: {
                    proposal: "${finished.data[i].id}"
                  }
                ) {
                  choice
                  metadata
                  space {
                    id
                  }
                }
              }`

            const voteResult = await request(this.URL_SPACE_PROPOSAL, voteQuery);
            console.log(voteResult.votes)
            const totalVotes = voteResult.votes.length;
            let choice1: number = 0;
            let choice2: number = 0;
            let res: number = 0;
            for (let j = 0; j < voteResult.votes.length; j++) {
                if (voteResult.votes[j].choice == 1)
                    choice1++;
                else
                    choice2++;

            }
            if (choice1 > choice2)
                res = Math.floor((choice1 / totalVotes) * 100)
            else
                res = Math.floor((choice2 / totalVotes) * 100)
            let message = {
                title:finished.data[i].title,
                res:(choice1>choice2?finished.data[i].choices[0]:finished.data[i].choices[1]),
                percent:res,
                id:finished.data[i].id
            }
            users.map(async (userAddress) => {            
                await this.processAndSendNotification(message, userAddress, NOTIFICATION_TYPE.STATUS,sdk,epns,simulate)
            })

        }

    }

    public async fetchNewProposalDetails() {
        logger.info(`[${new Date(Date.now())}]-[TrackerDAO]- Fetching New Proposals`)
        return request(this.URL_SPACE_PROPOSAL, this.NEW_PROPOSAL_QUERY).then(function (response) {
            return {
                success: true,
                data: response.proposals
            };
        })
            .catch(function (error) {
                return { success: false, error: error };
            });
    }

    public async processAndSendNotification(proposal, user, notificationType, sdk, epns, simulate) {
        logger.info(`[${new Date(Date.now())}]-[TracerDAO]- Preparing to send notification`)
        let title, message, payloadTitle, payloadMsg, notifType, cta, storageType, trxConfirmWait

        switch (notificationType) {
            case (NOTIFICATION_TYPE.NEW):
                for (let i = 0; i < proposal.length; i++) {
                    title = `New Proposal is live in TrcaerDAO`
                    message = `Title:${proposal[i].title}\nStart Date:${moment((proposal[i].start) * 1000).format("MMMM Do YYYY")}\nEnd Date:${moment((proposal[i].end) * 1000).format("MMMM Do YYYY")}`
                    payloadTitle = `New Proposal is live in TracerDAO`;
                    payloadMsg = `[d:Title] : ${proposal[i].title}\n[s:Start Date] : ${moment((proposal[i].start) * 1000).format("MMMM Do YYYY")}\n[t:End Date] : ${moment((proposal[i].end) * 1000).format("MMMM Do YYYY")} [timestamp: ${Math.floor(new Date() / 1000)}]`;
                    notifType = 3;
                    cta = `https://snapshot.org/#/tracer.eth/proposal/${proposal[i].id}`
                    storageType = 1;
                    trxConfirmWait = 0;
                    logger.info(proposal[i].title)
                    const payload = await sdk.advanced.preparePayload(user, notifType, title, message, payloadTitle, payloadMsg, cta, null)
                    const ipfsHash = await sdk.advanced.uploadToIPFS(payload, logger, null, simulate)
                    const tx = await sdk.advanced.sendNotification(epns.signingContract, user, notifType, storageType, ipfsHash, trxConfirmWait, logger, simulate)

                    // const tx = await sdk.sendNotification(globalDelegates[k].delegate, title, message, payloadTitle, payloadMsg, notificationType, simulate)
                    logger.info(tx);

                }
                break;
            case(NOTIFICATION_TYPE.STATUS):
                    title = `Proposal in TracerDAO concluded`
                    message = `Title:${proposal.title}\n Choice${proposal.res} got majority vote of ${proposal.percent}`
                    payloadTitle = `Proposal in TracerDAO concluded`;
                    payloadMsg = `[d:Title] : ${proposal.title}\nChoice [s:${proposal.res}] got majority vote of [b:${proposal.percent}]% [timestamp: ${Math.floor(new Date() / 1000)}]`;
                    notifType = 3;
                    cta = `https://snapshot.org/#/tracer.eth/proposal/${proposal.id}`
                    storageType = 1;
                    trxConfirmWait = 0;
                    logger.info(proposal.title)
                    const payload = await sdk.advanced.preparePayload(user, notifType, title, message, payloadTitle, payloadMsg, cta, null)
                    console.log(payload)
                    const ipfsHash = await sdk.advanced.uploadToIPFS(payload, logger, null, simulate)
                    const tx = await sdk.advanced.sendNotification(epns.signingContract, user, notifType, storageType, ipfsHash, trxConfirmWait, logger, simulate)

                    // const tx = await sdk.sendNotification(globalDelegates[k].delegate, title, message, payloadTitle, payloadMsg, notificationType, simulate)
                    logger.info(tx);


        }

    }

}