import { Service, Inject } from "typedi";
import config from "../config";
import channelWalletsInfo from "../config/channelWalletsInfo";
import { Pool, tickToPrice } from "@uniswap/v3-sdk";
import { Token } from '@uniswap/sdk-core';
import { ethers, logger} from 'ethers';
import epnsHelper, {InfuraSettings, NetWorkSettings, EPNSSettings} from '@epnsproject/backend-sdk-staging';


// TODO change channel key to that of uniswap v3 channel
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

const NETWORK_TO_MONITOR = config.web3MainnetNetwork;
const sdk = new epnsHelper(NETWORK_TO_MONITOR, channelKey, settings, epnsSettings);

@Service()
export default class UniswapV3Channel{
    constructor(){}
    // to check all the wallet addresses in the channel and send notification to teh interested subset
    public async sendMessageToContracts(simulate){
        logger.info(`[${new Date(Date.now())}]-[UNIV3 LP sendMessageToContracts] `);
        logger.info(`[UNIV3 LP sendMessageToContracts] - getting all the subscribers of a channel...`);
        
        //  Overide logic if need be
        const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") ? simulate.hasOwnProperty("logicOverride") : false) : false;
        let subscribers = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("addressesWithPositions") ? simulate.logicOverride.addressesWithPositions : false;
        //  -- End Override logic

        const txns = [] // to hold all the transactions of the sent notifications
        if(!subscribers){
            subscribers = await sdk.getSubscribedUsers()
        }

        // loop through all users and get their positions
        for(let subscriber of subscribers){
            logger.info(`[UNIV3 LP getPositions] - getting all posistions for subscriber ${subscriber}...`);

            const allPositions = await this.getPositions(subscriber, undefined);
            
            logger.info(`[UNIV3 LP getPositions] - getting details on all posistions for subscriber ${subscriber}...`);
            // -- go through all positions to confirm who is in range and who isnt
            for(let position of allPositions){
                // -- get all the required parameters
                const {
                    token0, token1, fee,
                    tickUpper, tickLower
                } = position;
                const positionDetails = await this.getPositionDetails(
                    token0, token1, fee,
                    tickUpper, tickLower, undefined
                );    
                logger.info(`[UNIV3 LP sendMessageToContracts] - Gotten details for position. ${positionDetails}.`);           
                const { withinTicks } = positionDetails;
                // -- if the current price is not within the set ticks then trigger a notif
                if(!withinTicks){
                    const title = "UniswapV3 LP position out of range";
                    const body = "you have stopped receiving fees for your LP position as it's out of range";
                    const payloadTitle = "UniswapV3 LP position out of range";
                    const payloadMsg = "you have stopped receiving fees for your LP position as it's out of range";
                    const notificationType = 3;
                    const tx = await sdk.sendNotification(
                        subscriber, title, body, payloadTitle,
                        payloadMsg, notificationType, simulate
                    );
                    txns.push(tx);
                    logger.info(`[UNIV3 LP sendMessageToContracts] - sent notification to ${subscriber}`); 
                }

            }
        }

        return {
            success: true,
            data: txns
        }
    }

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
        logger.info(`[UNIV3 LP getPositions] - There are a total of ${addressCount} positions...`);
        // loop through all the nftId's and get their corresponding positions
        for(let i = 0; i < parseInt(addressCount); i++){
            const nftId = ( await uniContract.contract.functions.tokenOfOwnerByIndex(userAddress, i) ).toString();
            const position = await uniContract.contract.functions.positions(nftId);
            positions.push(position);
            logger.info(`[UNIV3 LP getPositions] - Gotten position ${i} of ${addressCount} positions...`);
        }
        logger.info(`[UNIV3 LP getPositions] - all position for subscriber ${userAddress} gotten...`);
        return positions;
    }

    // to get the relative price of the tokens in a pool
    public async getPositionDetails(token0, token1, fees, upperTick, lowerTick, simulate){
        const PRICE_DECIMAL_PLACE = 3;
        // Overide logic if need be
        const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") ? simulate.hasOwnProperty("logicOverride") : false) : false;
        const poolToken0 = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("token0") ? simulate.logicOverride.token0 : token0;
        const poolToken1 = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("token1") ? simulate.logicOverride.token1 : token1;
        const poolFees = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("fees") ? simulate.logicOverride.fees : fees;
        const poolUpperTick = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("upperTick") ? simulate.logicOverride.upperTick : upperTick;
        const poolLowerTick = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("lowerTick") ? simulate.logicOverride.lowerTick : lowerTick;
        //  -- End Override logic
        
        // -- convert address to Token instance
        logger.info(`[UNIV3 LP getPositionDetails] - converting token address to Token instance...`);
            // -- Firstly to get the token's contract in order to get the decimal places of each token
        const tokenZeroDecimals = await (await sdk.getContract(poolToken0, config.erc20DeployedContractABI)).contract.functions.decimals();
        const tokenOneDecimals = await (await sdk.getContract(poolToken1, config.erc20DeployedContractABI)).contract.functions.decimals();
            // -- Next we use the decimals to obtain the token object
        const parsedTokenZero = new Token(1, poolToken0 , tokenZeroDecimals[0]);
        const parsedTokenOne = new Token(1, poolToken1 , tokenOneDecimals[0]);

        // Call Helper function to get pool factory contract
        const uniContract = await sdk.getContract(config.uniswapDeployedFactoryContract, config.uniswapDeployedFactoryContractABI);

        // get the pool adress and the pool contract
        logger.info(`[UNIV3 LP getPositionDetails] - Obtaining pool address and contract...`);
        const poolAddress = (await uniContract.contract.functions.getPool(
            poolToken0, poolToken1, poolFees
        ) ).toString();
        const poolContract = await sdk.getContract(poolAddress, config.uniswapDeployedPoolContractABI)
        
        // get the necessary details to fetch the relative price
        logger.info(`[UNIV3 LP getPositionDetails] - creating SDK liquidity pool instance...`);
        const tslot = await poolContract.contract.functions.slot0();
        const tliquidity = await poolContract.contract.functions.liquidity();
        const tsqrtPriceX96 = tslot.sqrtPriceX96;
        const ttick = tslot.tick;
        // use details to fetch an interface for the pool itself, so we can use it to fetch the price
        const liquidityPool = new Pool(
            parsedTokenZero,
            parsedTokenOne,
            poolFees,
            tsqrtPriceX96.toString(),
            tliquidity.toString(),
            ttick
        );
        // the price would be the higher of the relative prices of the two different assets in the pool
        logger.info(`[UNIV3 LP getPositionDetails] - calculating required prices from ticks...`);
        const firstRatio = Number(liquidityPool.token0Price.toFixed(PRICE_DECIMAL_PLACE))
        const secondRation = Number(liquidityPool.token1Price.toFixed(PRICE_DECIMAL_PLACE))
        const currentPrice = Math.max(firstRatio, secondRation);

        // Get the translation of the upper and lower tick
        const upperTickPrice1 = Number(tickToPrice(parsedTokenZero, parsedTokenOne, parseInt(poolUpperTick)).toFixed(PRICE_DECIMAL_PLACE));
        const upperTickPrice2 = Number(tickToPrice(parsedTokenOne, parsedTokenZero, parseInt(poolUpperTick)).toFixed(PRICE_DECIMAL_PLACE));
        const upperTickPrice = Math.max(upperTickPrice1, upperTickPrice2);
    
        const lowerTickPrice1 = Number(tickToPrice(parsedTokenZero, parsedTokenOne, parseInt(poolLowerTick)).toFixed(PRICE_DECIMAL_PLACE));
        const lowerTickPrice2 = Number(tickToPrice(parsedTokenOne, parsedTokenZero, parseInt(poolLowerTick)).toFixed(PRICE_DECIMAL_PLACE));
        const lowerTickPrice = Math.max(lowerTickPrice1, lowerTickPrice2);

        // calculate if the current price is within the ticks
        const withinTicks = ( currentPrice < lowerTickPrice ) && ( currentPrice > upperTickPrice );
        return {currentPrice, upperTickPrice, lowerTickPrice, withinTicks, poolAddress};
    }
}