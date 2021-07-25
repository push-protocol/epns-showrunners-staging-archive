import { Service, Inject } from "typedi";
import config from "../config";
import channelWalletsInfo from "../config/channelWalletsInfo";
import { ethers, logger } from "ethers";
import epnsHelper, {InfuraSettings, NetWorkSettings, EPNSSettings} from '@epnsproject/backend-sdk-staging';

const NETWORK_TO_MONITOR = config.web3MainnetNetwork;
const channelKey = channelWalletsInfo.walletsKV['uniSwapPrivateKey_1'];

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
const sdk = new epnsHelper(NETWORK_TO_MONITOR, channelKey, settings, epnsSettings);

@Service()
export default class UniswapV3Channel{
    constructor(){}

    // to send notifications
    public async getPositions(address:String, simulate){
        const uniContract = await sdk.getContract(config.uniswapV3Deployedcontract, config.uniswapV3ContractABI);
        
    }
}