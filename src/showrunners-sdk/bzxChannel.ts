// @name: BZX Channel
// @version: 1.0
// @recent_changes: Created Logic

import Web3 from 'web3';
import { Service, Inject } from 'typedi';
import config from '../config';
import { BZxJS } from "@bzxnetwork/bzx.js";
import channelWalletsInfo from '../config/channelWalletsInfo';
import { ethers, logger } from 'ethers';
import epnsHelper, {InfuraSettings, NetWorkSettings, EPNSSettings} from '@epnsproject/backend-sdk-staging'
import { SDK_VERSION } from 'firebase-admin';
import { ConfigBase } from 'aws-sdk/lib/config-base';

// TODO change to use bzx channel
const channelKey = channelWalletsInfo.walletsKV['uniSwapPrivateKey_1']

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
const NETWORK_TO_MONITOR = config.web3MainnetNetwork;
const DEBUG = true; //set to false to turn of logging
const CONTRACT_DEFAULTS = {
    'loanStart': 0, //when paginating loans, always start from the first one of index
    'isLender': false, // we are dealing with only borrowers not lenders
    'loanType': 0, //default to 0 to get all types of loans All(0), Margin(1), NonMargin(2)
    'unsafeOnly': false //if this is set to true, it would return only loans ready for liquidation, we hope to warn them before it gets to this tage
};

const sdk = new epnsHelper(NETWORK_TO_MONITOR, channelKey, settings, epnsSettings)
const debugLogger = (message) => DEBUG && logger.info(message);
@Service()
export default class bzxChannel {
    constructor(){}

    public async sendMessageToContract(simulate) {
        debugLogger(`[${new Date(Date.now())}]-[BZX sendMessageToContracts] `);

        debugLogger(`[BZX sendMessageToContracts] - getting all the subscribers of a channel...`);

        //  Overide logic if need be
        const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") ? simulate.hasOwnProperty("logicOverride") : false) : false;
        let subscribers = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("addressesWithLoans") ? simulate.logicOverride.addressesWithLoans : false;
        //  -- End Override logic
        const txns = [] // to hold all the transactions of the sent notifications
        if(!subscribers){
            subscribers = await sdk.getSubscribedUsers()
            debugLogger(`[BZX sendMessageToContracts] - gotten ${subscribers} from channel...`);
        }
        // initialise the bzx contract
        const isLender = false; //this variable would be false since we are concerned with 'borrowers' instead of lenders
        const bzxContract = await sdk.getContract(config.bzxLoanContract, config.bzxLoanDeployedContractABI);
        // // loop through all subscribers and get those with loans
        // const subscribersAndLoans = await Promise.all(subscribers.map(async (subscriber) => {
        //     const loanCountString = await bzxContract.contract.functions.getUserLoansCount(subscriber, isLender);
        //     const loanCount = parseInt(loanCountString.toString());
        //     return { loanCount, subscriber};
        // }));
        // // filter out subscribers without loans
        // const subscribersWithLoans = subscribersAndLoans
        //                                 .filter(({loanCount}) => loanCount)

        // for each subscriber get their loan details into a single array
        // for all these subscribers we then get their loans
        const loanCount = 1;
        const subscriber = '0x81016b5fa82b628e7653e63f43882009f90dc2b6';

        const userLoan = await bzxContract.contract.functions.getUserLoans(
            subscriber, CONTRACT_DEFAULTS.loanStart, loanCount,
            CONTRACT_DEFAULTS.loanType, isLender, CONTRACT_DEFAULTS.unsafeOnly
        );
        // after getting it into a single array, then check for liquidation or close to end date
        // send notification for it
        console.log(userLoan);

        const response = {
            success: "success",
            data: "data"
        }
        return response;
    }

}