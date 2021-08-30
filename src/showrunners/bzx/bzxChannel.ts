// @name: BZX Channel
// @version: 1.0
// @recent_changes: Created Logic

import moment from 'moment';
import { Service, Inject } from 'typedi';
import { logger } from 'ethers';
import config from '../../config';
import showrunnersHelper from '../../helpers/showrunnersHelper';
import epnsHelper, { InfuraSettings, NetWorkSettings, EPNSSettings } from '@epnsproject/backend-sdk-staging';
import epnsNotify from '../helpers/epnsNotifyHelper';

const bent = require('bent'); // Download library
const bzxSettings = require("./bzxSettings.json")
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
    'tradeCTA': 'https://app.fulcrum.trade/borrow/user-loans',
}

const contractABI={
    erc20DeployedContractABI:require("./erc20.json"),
    bzxLoanDeployedContractABI:require("./bzx_loanPool.json")
}
const debugLogger = (message) => DEBUG && logger.info(message);
const getJSON = bent('json');

@Service()
export default class bzxChannel {
    constructor(
        @Inject('logger') private logger
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

    public async sendMessageToContract(simulate) {
        try {

            const walletKey = await this.getWalletKey()
            const sdk = new epnsHelper(config.web3MainnetNetwork, walletKey, settings, epnsSettings);

            debugLogger(`[${new Date(Date.now())}]-[BZX sendMessageToContracts] `);

            debugLogger(`[BZX sendMessageToContracts] - getting all the subscribers of a channel...`);

            //  Overide logic if need be
            const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") ? simulate.hasOwnProperty("logicOverride") : false) : false;
            let subscribers = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("addressesWithLoans") ? simulate.logicOverride.addressesWithLoans : false;
            //  -- End Override logic
            const txns = [];
            if (!subscribers) {
                subscribers = await sdk.getSubscribedUsers()
                debugLogger(`[BZX sendMessageToContracts] - gotten ${subscribers} from channel...`);
            }
            // initialise the bzx contract
            const isLender = false; //this variable would be false since we are concerned with 'borrowers' instead of lenders
            const bzxContract = await sdk.getContract(bzxSettings.bzxLoanContract, contractABI.bzxLoanDeployedContractABI);
            // loop through all subscribers and get those with loans
            debugLogger(`[BZX sendMessageToContracts] - getting all the subscribers and the number of loans they have`);
            const subscribersAndLoans = await Promise.all(subscribers.map(async (subscriber) => {
                const loanCountString = await bzxContract.contract.functions.getUserLoansCount(subscriber, isLender);
                const loanCount = parseInt(loanCountString.toString());
                return { loanCount, subscriber };
            }));
            // filter out subscribers without loans
            const subscribersWithLoans = subscribersAndLoans
                .filter(({ loanCount }) => loanCount)

            // for each subscriber get their loan details into a single array
            // for all these subscribers we then get their loans
            debugLogger(`[BZX sendMessageToContracts] - filtering out subscribers with no loans`);
            const allSubscribersLoans = await Promise.all(subscribersWithLoans.map(async (oneSubscriber) => {
                const { loanCount, subscriber } = oneSubscriber;
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
            debugLogger(`[BZX sendMessageToContracts] - selecting customers who meet our conditions for notifications`);
            await Promise.all(allLoans.map(async (oneLoan) => {
                const {
                    endTimestamp, startMargin,
                    currentMargin, maintainanceMargin,
                    subscriber, loanToken
                } = oneLoan;
                // get details on the loan token
                const tokenContract = await sdk.getContract(loanToken, contractABI.erc20DeployedContractABI);
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
                if (belowBoundary) {
                    // send them a notification that they are close to liquidation
                    debugLogger(`[BZX sendMessageToContracts] - The Loan of ${loanTokenName} of subscriber :${subscriber},  is below treshold with current margin of :${currentMarginPrice} & maintainance margin:${mainatananceMarginPrice}`);
                    const title = `BzX Loan of ${loanTokenName} is approaching liquidation`;
                    const body = `Your loan of ${loanTokenName} is approaching liquidation please fund your account`;
                    const payloadTitle = `BzX Loan of ${loanTokenName} is approaching liquidation`;
                    const payloadMsg = `Your loan of ${loanTokenName} is approaching liquidation please fund your account.\n\n[d: Current Margin Price]: $${currentMarginPrice.toFixed(2)}\n\n[s: Maintainance Margin Price]: $${mainatananceMarginPrice.toFixed(2)} [timestamp: ${Math.floor(+new Date() / 1000)}]`;
                    const cta = CUSTOMIZABLE_DEFAULTS.tradeCTA;

                    const notificationType = 3;
                    const tx = await this.sendNotification(
                        subscriber, title, body, payloadTitle,
                        payloadMsg, notificationType, CUSTOMIZABLE_DEFAULTS.tradeCTA,
                        simulate
                    );
                    // to remove after testing
                    debugLogger(`[BZX sendMessageToContracts] - sent notification to ${subscriber}`);
                    txns.push(tx);
                }
                if (warningDate) {
                    debugLogger(`[BzX sendMessageToContracts] - The Loan of ${loanTokenName} of subscriber :${subscriber},  is ${dateDifference} days from expiration`);
                    const title = `BzX Loan of ${loanTokenName} is close to it's tenor end.`;
                    const body = `Your Loan of ${loanTokenName} from BzX is [s: ${dateDifference} Days] away from its due date\n\n[d: Due Date]: ${parsedEndDate.format(CUSTOMIZABLE_DEFAULTS.dateFormat)}`;
                    const payloadTitle = `BzX Loan of ${loanTokenName} close to it's tenor end.`;
                    const payloadMsg = `Your Loan of ${loanTokenName} from BzX is [s: ${dateDifference} Days away from its due date]`;

                    const notificationType = 3;
                    const tx = await this.sendNotification(
                        subscriber, title, body, payloadTitle,
                        payloadMsg, notificationType, CUSTOMIZABLE_DEFAULTS.loansCTA,
                        simulate
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
        } catch (err) {
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

    public async sendNotification(subscriber, title, body, payloadTitle, payloadMsg, notificationType, cta, simulate){
        const logger = this.logger;
        debugLogger("[UNIV3 LP sendNotification] - Getting EPNS interactable contract ")
        const epns = this.getEPNSInteractableContract(config.web3RopstenNetwork);
        const payload = await epnsNotify.preparePayload(
            null,
            notificationType,
            title,
            body,
            payloadTitle,
            payloadMsg,
            cta,
            null
        );
        debugLogger('Payload Prepared: %o' + JSON.stringify(payload));

        const txn = await epnsNotify.uploadToIPFS(payload, logger, simulate)
            .then(async (ipfshash) => {
                debugLogger("Success --> uploadToIPFS(): %o" + ipfshash);
                const storageType = 1; // IPFS Storage Type
                const txConfirmWait = 0; // Wait for 0 tx confirmation
                // Send Notification
                const notification = await epnsNotify.sendNotification(
                    epns.signingContract,                                           // Contract connected to signing wallet
                    subscriber,        // Recipient to which the payload should be sent
                    parseInt(payload.data.type),                                    // Notification Type
                    storageType,                                                    // Notificattion Storage Type
                    ipfshash,                                                       // Notification Storage Pointer
                    txConfirmWait,                                                  // Should wait for transaction confirmation
                    logger,                                                         // Logger instance (or console.log) to pass
                    simulate                                                        // Passing true will not allow sending actual notification
                ).then ((tx) => {
                    debugLogger("Transaction mined: %o | Notification Sent" + tx.hash);
                    debugLogger("🙌 bzx Channel Logic Completed!");
                    return tx;
                })
                .catch (err => {
                    logger.error("🔥Error --> sendNotification(): %o", err);
                });

                return notification;
            })
            .catch (err => {
                logger.error("🔥Error --> Unable to obtain ipfshash, error: %o" + err.message);
            });

            return txn;
    }

    public async getEPNSInteractableContract(web3network) {
        // Get Contract
        const walletKey = await this.getWalletKey()
        return epnsNotify.getInteractableContracts(
            web3network,                                                                // Network for which the interactable contract is req
            {                                                                       // API Keys
                etherscanAPI: config.etherscanAPI,
                infuraAPI: config.infuraAPI,
                alchemyAPI: config.alchemyAPI
            },
            walletKey,                   // Private Key of the Wallet sending Notification
            config.deployedContract,                                                // The contract address which is going to be used
            config.deployedContractABI                                              // The contract abi which is going to be useds
        );
    }
}