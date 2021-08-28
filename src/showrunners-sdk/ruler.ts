import { Service, Inject } from 'typedi';
import config from '../config';
import channelWalletsInfo from '../config/channelWalletsInfo';
// import PQueue from 'p-queue';
import { ethers, logger } from 'ethers';
import epnsHelper, {InfuraSettings, NetWorkSettings, EPNSSettings} from '@epnsproject/backend-sdk-staging';
import epnsNotify from '../helpers/epnsNotifyHelper';

const channelKey = channelWalletsInfo.walletsKV['rulerProtocolPrivateKey_1'];

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
const sdk = new epnsHelper(config.web3KovanNetwork, channelKey, settings, epnsSettings);



@Service()
export default class RulerChannel {
    constructor(
        @Inject('logger') private logger,
    ) {}

    public async sendMessageToContract(simulate) {
        const rulerContract = await sdk.getContract(config.rulerDeployedcontract, config.rulerDeployedcontractABI);

        subscribers = await sdk.getSubscribedUsers(rulerContract);
        const collaterals = await this.get_collaterals();
        logger.debug('Ruler: Got collaterals');
        for (let i = 0; i < collaterals.length; i++) {
            const pairLists = await this.get_pair_list(rulerContract, collaterals[i]);
            logger.debug('Ruler: Got pairList');
            for (let j = 0; j < pairLists.length; j++) {
                let expiry = pairList[j].expiry;
                if(pairList[j].active && Math.round(Date.now() / 1000) + 86400 >= pairList[j].expiry) {
                    let rrToken = pairList[j].rrToken;
                    for (let k = 0; k < subscribers.length; k++) {
                        let rrTokenBalance = await this.get_rr_balance(rrToken, susbcribers[k]);

                        if (rrTokenBalance > 0) {
                            const title = "Ruler: Loan about to be expired";
                            const body = "Your loans on Ruler is about to be expire and be liquidated in less than a day";
                            const payloadTitle = "Ruler: Loan about to be expired";
                            const payloadMsg = "Your loans on Ruler is about to be expire and be liquidated in less than a day";
                            const notificationType = 3;
                            const tx = await sdk.sendNotification(subscribers[k], title, body, payloadTitle, payloadMsg, notificationType, simulate);
                            logger.info(tx);
                        }
                    }
                }
            }
        }
    }

    public async get_collaterals(rulerContract) {
        const collaterals = await rulerContract.contract.functions.getCollaterals();

        return collaterals;
    }

    public async get_pair_list(rulerContract, collateral : string) {
        const pairList = await rulerContract.contract.functions.getPairList(collateral);

        return pairList;
    }

    public async get_rr_balance(erc20: string, user: string) {
        const rr = await sdk.getContract(erc20, config.ERC20ABI);

        const balance = await rr.contract.functions.balanceOf(user);

        return balance;
    }
}
