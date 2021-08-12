// @name: BZX Channel
// @version: 1.0
// @recent_changes: Created Logic

import moment from 'moment';
import { Service, Inject, Token } from 'typedi';
import config from '../config';
import channelWalletsInfo from '../config/channelWalletsInfo';
import { ethers, logger } from 'ethers';
// import epnsHelper, {InfuraSettings, NetWorkSettings, EPNSSettings} from '../../../epns-backend-sdk-staging/src';
import epnsHelper, {InfuraSettings, NetWorkSettings, EPNSSettings} from '@epnsproject/backend-sdk-staging';

const bent = require('bent'); // Download library

// TODO change to use bzx channel
// const channelKey = channelWalletsInfo.walletsKV['yamGovernancePrivateKey_1'];
const channelKey = '0xf71b681abcd31f5e94f049aed513684fa0c8dcfdb7ff93b08dcbaabc79493ba8';

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
    'unsafeOnly': false, //if this is set to true, it would return only loans ready for liquidation, we hope to warn them before it gets to this stage,
    'tenorTreshold': 3, // number of days from loan tenor end we would want to alert them. i.e 3 days before their loan expires
    'liquidationTreshold': 10, //percentage we would want to notify them when their current margin is within 10% above the minimum margin allowed before liquidation
    'dateUnit': 'days', //the unit which we want to to compare date differences.
};
const CUSTOMIZABLE_DEFAULTS = {
    'toEth': (num) => Number((num / (10 ** 18)).toFixed(3)), // convert a number from eth to unit 3.dp
    'dateFormat': "DD-MM-YY",
    'precision': 3, //number of decimal places
    'loansCTA': 'https://app.fulcrum.trade/borrow/user-loans',
    'tradeCTA': 'https://app.fulcrum.trade/trade';
}

const sdk = new epnsHelper(NETWORK_TO_MONITOR, channelKey, settings, epnsSettings)
const debugLogger = (message) => DEBUG && logger.info(message);
const getJSON = bent('json');

@Service()
export default class bzxChannel {
    constructor(){}

    public async sendMessageToContract(simulate) {
        try{

            debugLogger(`[${new Date(Date.now())}]-[BZX sendMessageToContracts] `);
    
            debugLogger(`[BZX sendMessageToContracts] - getting all the subscribers of a channel...`);
    
            //  Overide logic if need be
            const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") ? simulate.hasOwnProperty("logicOverride") : false) : false;
            let subscribers = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("addressesWithLoans") ? simulate.logicOverride.addressesWithLoans : false;
            //  -- End Override logic
            const txns = [];
            if(!subscribers){
                subscribers = await sdk.getSubscribedUsers()
                debugLogger(`[BZX sendMessageToContracts] - gotten ${subscribers} from channel...`);
            }
            // initialise the bzx contract
            const isLender = false; //this variable would be false since we are concerned with 'borrowers' instead of lenders
            const bzxContract = await sdk.getContract(config.bzxLoanContract, config.bzxLoanDeployedContractABI);
            // loop through all subscribers and get those with loans
            debugLogger(`[BZX sendMessageToContracts] - getting all the subscribers and the number of loans they have`);
            const subscribersAndLoans = await Promise.all(subscribers.map(async (subscriber) => {
                const loanCountString = await bzxContract.contract.functions.getUserLoansCount(subscriber, isLender);
                const loanCount = parseInt(loanCountString.toString());
                return { loanCount, subscriber};
            }));
            // filter out subscribers without loans
            const subscribersWithLoans = subscribersAndLoans
                                            .filter(({loanCount}) => loanCount)
    
            // for each subscriber get their loan details into a single array
            // for all these subscribers we then get their loans
            debugLogger(`[BZX sendMessageToContracts] - getting all the subscribers and the number of loans they have, as well as the information in the loan`);
            const allSubscribersLoans = await Promise.all(subscribersWithLoans.map(async (oneSubscriber) => {
                const { loanCount , subscriber } = oneSubscriber;
                // using the details above get all the active laons the user has
                const [userLoan] = await bzxContract.contract.functions.getUserLoans(
                    subscriber, CONTRACT_DEFAULTS.loanStart, loanCount,
                    CONTRACT_DEFAULTS.loanType, isLender, CONTRACT_DEFAULTS.unsafeOnly
                );
                // extract information from loan
                const extractedLoanInfo = userLoan.map((oneLoan) => {
                    const {
                        endTimestamp, startMargin, currentMargin,
                        maintenanceMargin, loanToken
                    } = oneLoan;
                    // extract details which enable us to send notifications if some criteria is met
                    return {
                        endTimestamp: endTimestamp.toString(), 
                        startMargin: startMargin.toString(), 
                        currentMargin: currentMargin.toString(), 
                        maintainanceMargin: maintenanceMargin.toString(),
                        subscriber, loanToken
                    }
                });
    
                return extractedLoanInfo;
            }));
    
            // the above gives us an array of arrays, flatten it to prevent multiple nested loops
            const allLoans = [].concat.apply([], allSubscribersLoans);
    
            // go through all the loans and if they meet any of our criterias then we send the notification
            debugLogger(`[BZX sendMessageToContracts] - getting all the subscribers and the number of loans they have, as well as the information in the loan`);
            await Promise.all(allLoans.map(async(oneLoan) => {
                const {
                    endTimestamp, startMargin,
                    currentMargin, maintainanceMargin,
                    subscriber, loanToken
                } = oneLoan;
                // get details on the token
                const tokenContract = await sdk.getContract(loanToken, config.erc20DeployedContractABI);
                const [loanTokenName] = (await tokenContract.contract.functions.name());
                const [loanTokenSymbol] = (await tokenContract.contract.functions.symbol());
                const loanTokenPrice = await this.getPrice(loanTokenSymbol, undefined);
    
                // convert the timeStamp to date and find how many days it is away from today
                const parsedEndDate = moment(parseInt(endTimestamp) * 1000);
                const dateDifference = parsedEndDate.diff(moment(), CONTRACT_DEFAULTS.dateUnit);
                // check if the currentMargin is within 10% above the mainatanance margin
                const upperBoundary = parseInt(maintainanceMargin) + (parseInt(maintainanceMargin) * CONTRACT_DEFAULTS.liquidationTreshold / 100);
                // calculate current prices
                const currentMarginPrice = loanTokenPrice * CUSTOMIZABLE_DEFAULTS.toEth(currentMargin) // convert the margins to units;
                const mainatananceMarginPrice = loanTokenPrice * CUSTOMIZABLE_DEFAULTS.toEth(maintainanceMargin) //convert the margins to units;
                // define the conditions for sending notifications
                const belowBoundary = upperBoundary > currentMargin; // this would be true if the current margin is less that 10 percent greater than the maintainance margin
                const warningDate = CONTRACT_DEFAULTS.tenorTreshold > dateDifference; // this would be true if the loan is within x days of its expiration date
                // if(belowBoundary){
                if(true){
                    // send them a notification that they are close to liquidation
                    debugLogger(`[BZX sendMessageToContracts] - The Loan of ${loanTokenName} of subscriber :${subscriber},  is below treshold with current margin of :${currentMarginPrice} & maintainance margin:${mainatananceMarginPrice}`);
                    const title = `BzX Loan of ${loanTokenName} is approaching liquidation`;
                    const body = `BzX Loan of ${loanTokenName} is approaching liquidation please fund your account`;
                    const payloadTitle = `BzX Loan of ${loanTokenName} is approaching liquidation`;
                    const payloadMsg = `BzX Loan of ${loanTokenName} is approaching liquidation please fund your account.\n\n[d: Current Margin Price]: $${currentMarginPrice}\n\n[s: Maintainance Margin Price]: $${mainatananceMarginPrice} [timestamp: ${Math.floor(+new Date() / 1000)}]`;
                    const cta = CUSTOMIZABLE_DEFAULTS.tradeCTA;
                    // const notificationType = 3;
                    // const tx = await sdk.sendNotification(
                    //     subscriber, title, body, payloadTitle,
                    //     payloadMsg, notificationType, simulate
                    // );
                    const notificationType = 1;
                    const channelAddress = ethers.utils.computeAddress(channelKey);
                    const tx = await sdk.sendNotification(
                        channelAddress, title, body, payloadTitle,
                        payloadMsg, notificationType, simulate
                    );
                    // to remove after testing
                    debugLogger(`[BZX sendMessageToContracts] - sent notification to ${subscriber}`); 
                    txns.push(tx);
                }
                // if (warningDate){
                if (true){
                    debugLogger(`[BzX sendMessageToContracts] - The Loan of ${loanTokenName} of subscriber :${subscriber},  is ${dateDifference} days from expiration`);
                    const title = `BzX Loan of ${loanTokenName} is close to it's tenor end.`;
                    const body = `Your Loan of ${loanTokenName} from BzX is [s: ${dateDifference} Days] away from its due date\n\n[d: Due Date]: ${parsedEndDate.format(CUSTOMIZABLE_DEFAULTS.dateFormat)}`;
                    const payloadTitle = `BzX Loan of ${loanTokenName} close to it's tenor end.`;
                    const payloadMsg = `Your Loan of ${loanTokenName} from BzX is [s: ${dateDifference} Days away from its due date]`;
                    const cta = CUSTOMIZABLE_DEFAULTS.loansCTA;
                    // const notificationType = 3;
                    // const tx = await sdk.sendNotification(
                    //     subscriber, title, body, payloadTitle,
                    //     payloadMsg, notificationType, simulate
                    // );
                    // to remove after testing
                    const notificationType = 1;
                    const channelAddress = ethers.utils.computeAddress(channelKey);
                    const tx = await sdk.sendNotification(
                        channelAddress, title, body, payloadTitle,
                        payloadMsg, notificationType, simulate
                    );
                    // to remove after testing
                    debugLogger(`[BZX sendMessageToContracts] - sent notification to ${subscriber}`); 
                    txns.push(tx);
                }
            }));
    
            const response = {
                success: "success",
                data: txns
            }
            return response;
        } catch(err){
            const response = {
                error: err.message,
                data: []
            }
            return response;
        }
    }
    public async getPrice(symbol, simulate){
        // to get the current price of a token by its symbol
        //  Overide logic if need be
        const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") ? simulate.hasOwnProperty("logicOverride") : false) : false;
        const tokenSymbol = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("symbol") ? simulate.logicOverride.symbol : symbol;
        //  -- End Override logic
    
        const cmcroute = 'v1/cryptocurrency/quotes/latest';
        const pollURL = `${config.cmcEndpoint}${cmcroute}?symbol=${tokenSymbol}&CMC_PRO_API_KEY=${config.cmcAPIKey}`;
        debugLogger(`[BZX getPrice] obtaining prices from CMC API`);
        const response = await getJSON(pollURL);
        const data = response.data[tokenSymbol];
        const price = Number(data.quote.USD.price.toFixed(CUSTOMIZABLE_DEFAULTS.precision));
        debugLogger(`[BZX getPrice] obtained prices for token ${tokenSymbol} as ${price}`);
        return price;
    }

}