// @name: UniSwapv3 Channel
// @version: 1.0
// @recent_changes: Changed Logic to be modular

import { Service, Inject } from 'typedi';
import config from '../../config';
import showrunnersHelper from '../../helpers/showrunnersHelper';
import { ethers, logger} from 'ethers';
import { Pool, tickToPrice } from "@uniswap/v3-sdk";
import { Token } from '@uniswap/sdk-core';
import epnsHelper, {InfuraSettings, NetWorkSettings, EPNSSettings} from '@epnsproject/backend-sdk-staging'
import epnsNotify from '../../helpers/epnsNotifyHelper';

const uniswapv3Setting = require("./uniswapv3Settings.json")
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

  const DEBUG = true; //set to false to turn of logging
  const NETWORK_TO_MONITOR = config.web3MainnetNetwork;
  const UNISWAP_POOL_URL = "https://app.uniswap.org/#/pool/";
  const CUSTOMIZABLE_SETTINGS = {
      'precision': 3, // precision of the floating point decimals
      'homestead': 1, // the chain id for mainnet
      'ropsten': 3, // the chain id for ropsten
      'kovan': 42 // the chain id for kovan.
  };

  const contractABI={
    uniswapV3DeployedcontractABI:require("./univ3_contract.json"),
    uniswapDeployedFactoryContractABI:require("./univ3_factory_contract.json"),
    uniswapDeployedPoolContractABI:require("./univ3_pool_contract.json"),
    erc20DeployedContractABI:require("./erc20.json")
  }

  const debugLogger = (message) => DEBUG && logger.info(message);

  export default class UniswapV3Channel{
    constructor(
        @Inject('logger') private logger,
    ){}

    public async getWalletKey() {
        var path = require('path');
        const dirname = path.basename(__dirname);
        const wallets = config.showrunnerWallets[`${dirname}`];
        const currentWalletInfo = await showrunnersHelper.getValidWallet(dirname, wallets);
        const walletKeyID = `wallet${currentWalletInfo.currentWalletID}`;
        const walletKey = wallets[walletKeyID];
        return walletKey;
    }

    // to check all the wallet addresses in the channel and send notification to teh interested subset
    public async sendMessageToContracts(simulate){
        debugLogger(`[${new Date(Date.now())}]-[UNIV3 LP sendMessageToContracts] `);
        debugLogger(`[UNIV3 LP sendMessageToContracts] - getting all the subscribers of a channel...`);
        
        //  Overide logic if need be
        const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") ? simulate.hasOwnProperty("logicOverride") : false) : false;
        let subscribers = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("addressesWithPositions") ? simulate.logicOverride.addressesWithPositions : false;
        //  -- End Override logic
        const walletKey = await this.getWalletKey()
        const sdk = new epnsHelper(NETWORK_TO_MONITOR, walletKey, settings, epnsSettings);
            
        const txns = [] // to hold all the transactions of the sent notifications
        if(!subscribers){
            subscribers = await sdk.getSubscribedUsers()
            debugLogger(`[UNIV3 LP getPositions] - gotten ${subscribers} from channel...`);
        }

        // loop through all users and get their positions
        for(let subscriber of subscribers){
            debugLogger(`[UNIV3 LP getPositions] - getting all posistions for subscriber ${subscriber}...`);

            const allPositions = await this.getPositions(subscriber,sdk, undefined);
            
            debugLogger(`[UNIV3 LP getPositions] - getting details on all posistions for subscriber ${subscriber}...`);
            // -- go through all positions to confirm who is in range and who isnt
            for(let position of allPositions){
                // -- get all the required parameters
                const {
                    token0, token1, fee,
                    tickUpper, tickLower
                } = position;
                const positionDetails = await this.getPositionDetails(
                    token0, token1, fee,
                    tickUpper, tickLower,sdk, undefined
                );    
                debugLogger(`[UNIV3 LP sendMessageToContracts] - Gotten details for position: ${JSON.stringify(positionDetails)}`,);           
                const {
                    withinTicks, tokenZeroName,
                    tokenOneName, currentPrice,
                    upperTickPrice, lowerTickPrice,
                    ctaLink
                } = positionDetails;
                // -- if the current price is not within the set ticks then trigger a notif
                if(!withinTicks){
                    let storageType = 1;
                    let trxConfirmWait = 0;
                    const title = `UniswapV3 LP position out of range.`;
                    const body = `You have stopped receiving fees for your LP position ${tokenZeroName}-${tokenOneName}`;
                    const payloadTitle = `UniswapV3 LP position out of range`;
                    const payloadMsg = `You have stopped receiving fees for your LP position ${tokenOneName} - ${tokenZeroName}.\n\n[d: Current Price]: $${currentPrice}\n[s: LP Range]: $${upperTickPrice} - $${lowerTickPrice}. [timestamp: ${Math.floor(new Date() / 1000)}]`;
                    const notificationType = 3;

                    const payload = await sdk.advanced.preparePayload(subscriber, notificationType, title, body, payloadTitle, payloadMsg, ctaLink, null)
                    const ipfsHash = await sdk.advanced.uploadToIPFS(payload, logger, null, simulate)
                    const epns = sdk.advanced.getInteractableContracts(
                        epnsSettings.network,
                        {
                            // API Keys
                            etherscanAPI: settings.etherscan,
                            infuraAPI: settings.infura,
                            alchemyAPI: settings.alchemy,
                        },
                        walletKey, // Private Key of the Wallet sending Notification
                        epnsSettings.contractAddress, // The contract address which is going to be used
                        epnsSettings.contractABI
                    )
                    const tx:any = await sdk.advanced.sendNotification(epns.signingContract, subscriber, notificationType, storageType, ipfsHash, trxConfirmWait, logger, simulate)
                    txns.push(tx);
                    debugLogger(`[UNIV3 LP sendMessageToContracts] - sent notification to ${subscriber}`); 
                }

            }
        }

        return {
            success: true,
            data: txns
        }
    }

     // to send get nft positions of a particular address
     public async getPositions(address:String,sdk:any, simulate){
        let positions = []
        //  Overide logic if need be
        const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") ? simulate.hasOwnProperty("logicOverride") : false) : false;
        const userAddress = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("address") ? simulate.logicOverride.address : address;
        //  -- End Override logic

        // Call Helper function to get interactableContracts
        const uniContract = await sdk.getContract(uniswapv3Setting.uniswapV3Deployedcontract, contractABI.uniswapV3DeployedcontractABI);

        // get all the number of nft tokens a user with the adress has
        const addressCount = ( await uniContract.contract.functions.balanceOf(userAddress) ).toString();
        debugLogger(`[UNIV3 LP getPositions] - There are a total of ${addressCount} positions...`);
        // loop through all the nftId's and get their corresponding positions
        for(let i = 0; i < parseInt(addressCount); i++){
            const nftId = ( await uniContract.contract.functions.tokenOfOwnerByIndex(userAddress, i) ).toString();
            const position = await uniContract.contract.functions.positions(nftId);
            positions.push(position);
            debugLogger(`[UNIV3 LP getPositions] - Gotten position ${i} of ${addressCount} positions...`);
        }
        debugLogger(`[UNIV3 LP getPositions] - all position for subscriber ${userAddress} gotten...`);
        return positions;
    }

        // to get the relative price of the tokens in a pool
        public async getPositionDetails(token0, token1, fees, upperTick, lowerTick, sdk, simulate){
            const PRICE_DECIMAL_PLACE = CUSTOMIZABLE_SETTINGS.precision;
            const MAIN_NETWORK_ID = CUSTOMIZABLE_SETTINGS[NETWORK_TO_MONITOR];
            // Overide logic if need be
            const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") ? simulate.hasOwnProperty("logicOverride") : false) : false;
            const poolToken0 = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("token0") ? simulate.logicOverride.token0 : token0;
            const poolToken1 = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("token1") ? simulate.logicOverride.token1 : token1;
            const poolFees = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("fees") ? simulate.logicOverride.fees : fees;
            const poolUpperTick = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("upperTick") ? simulate.logicOverride.upperTick : upperTick;
            const poolLowerTick = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("lowerTick") ? simulate.logicOverride.lowerTick : lowerTick;
            //  -- End Override logic
            
            // -- convert address to Token instance
            debugLogger(`[UNIV3 LP getPositionDetails] - converting token address to Token instance...`);
                // -- Firstly to get the token's contract in order to get the details  of each token
            const tokenZeroContract = await sdk.getContract(poolToken0, contractABI.erc20DeployedContractABI);
                // -- Next get details about the two tokens
            const tokenOneContract = await sdk.getContract(poolToken1, contractABI.erc20DeployedContractABI);
            const tokenZeroDecimals = await tokenZeroContract.contract.functions.decimals();
            const tokenOneDecimals = await tokenOneContract.contract.functions.decimals();
            const tokenZeroName = (await tokenZeroContract.contract.functions.symbol())[0];
            const tokenOneName = (await tokenOneContract.contract.functions.symbol())[0];
                // -- Next we use the decimals to obtain the token object
            const parsedTokenZero = new Token(MAIN_NETWORK_ID, poolToken0 , tokenZeroDecimals[0]);
            const parsedTokenOne = new Token(MAIN_NETWORK_ID, poolToken1 , tokenOneDecimals[0]);
            // Call Helper function to get pool factory contract
            const uniContract = await sdk.getContract(uniswapv3Setting.uniswapDeployedFactoryContract, contractABI.uniswapDeployedFactoryContractABI);
    
            // get the pool adress and the pool contract
            debugLogger(`[UNIV3 LP getPositionDetails] - Obtaining pool address and contract...`);
            const poolAddress = (await uniContract.contract.functions.getPool(
                poolToken0, poolToken1, poolFees
            ) ).toString();
            const poolContract = await sdk.getContract(poolAddress, contractABI.uniswapDeployedPoolContractABI)
            const ctaLink = `${UNISWAP_POOL_URL}`
            
            // get the necessary details to fetch the relative price
            debugLogger(`[UNIV3 LP getPositionDetails] - creating SDK liquidity pool instance...`);
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
            debugLogger(`[UNIV3 LP getPositionDetails] - calculating required prices from ticks...`);
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
            const maxTick = Math.max(lowerTickPrice, upperTickPrice);
            const minTick = Math.min(lowerTickPrice, upperTickPrice);
            const withinTicks = ( currentPrice > minTick ) && ( currentPrice < maxTick );
            return {
                currentPrice, upperTickPrice, lowerTickPrice, withinTicks,
                poolAddress, tokenZeroName, tokenOneName, ctaLink
            };
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
                        debugLogger("🙌 UNISWAP Channel Logic Completed!");
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