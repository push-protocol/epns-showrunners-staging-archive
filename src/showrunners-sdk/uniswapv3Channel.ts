import { Service, Inject } from "typedi";
import config from "../config";
import channelWalletsInfo from "../config/channelWalletsInfo";
import { computePoolAddress, Pool   } from "@uniswap/v3-sdk";
import { Token } from '@uniswap/sdk-core'
import { ethers, logger } from "ethers";
import epnsHelper, {InfuraSettings, NetWorkSettings, EPNSSettings} from '@epnsproject/backend-sdk-staging';

const NETWORK_TO_MONITOR = config.web3RopstenNetwork;
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

    // to send get nft positions of a particular address
    public async getPositions(address:String, simulate){
        let positions = []
        //  Overide logic if need be
        const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") ? simulate.hasOwnProperty("logicOverride") : false) : false;
        const userAddress = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("address") ? simulate.logicOverride.address : address;
        //  -- End Override logic

        // Call Helper function to get interactableContracts
        const uniContract = await sdk.getContract(config.uniswapV3Deployedcontract, config.uniswapV3DeployedcontractABI);

        // get all the number of nft tokens a user with the adress has
        const addressCount = ( await uniContract.contract.functions.balanceOf(userAddress) ).toString();
        // loop through all the nftId's and get their corresponding positions
        for(let i=0; i < parseInt(addressCount); i++){
            const nftId = ( await uniContract.contract.functions.tokenOfOwnerByIndex(userAddress, i) ).toString();
            const position = await uniContract.contract.functions.positions(nftId);
            positions.push(position);
        }
        return positions;
    }

    // to get the relative price of the tokens in a pool
    public async getRelativePrice(token0, token1, fees, simulate){

        // Overide logic if need be
        const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") ? simulate.hasOwnProperty("logicOverride") : false) : false;
        const poolToken0 = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("token0") ? simulate.logicOverride.token0 : token0;
        const poolToken1 = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("token1") ? simulate.logicOverride.token1 : token1;
        const poolFees = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("fees") ? simulate.logicOverride.fees : fees;
        //  -- End Override logic
        
        // Call Helper function to get interactableContracts
        const uniContract = await sdk.getContract(config.uniswapDeployedFactoryContract, config.uniswapDeployedFactoryContractABI);
        const parsedTokenZero = new Token(3, poolToken0 , 18);
        const parsedTokenOne = new Token(3, poolToken0 , 18);
        console.log({parsedTokenOne, parsedTokenZero});
        const poolAddress = await uniContract.contract.functions.getPool(
            poolToken0, poolToken1, poolFees
        )
        // const apoolAddress = await Pool.getAddress(parsedTokenZero, parsedTokenOne, fees);

        console.log({poolAddress});

        return 1000
    }
}