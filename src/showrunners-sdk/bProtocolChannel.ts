// @name: BProtocol Channel
// @version: 1.0
// @recent_changes:

import { Service, Inject, Container } from 'typedi';
import config from '../config';
import channelWalletsInfo from '../config/channelWalletsInfo';
// import PQueue from 'p-queue';
import { ethers, logger } from 'ethers';
// import epnsHelper, { InfuraSettings, NetWorkSettings, EPNSSettings } from '../../../epns-backend-sdk-staging/src'
import epnsHelper, { InfuraSettings, NetWorkSettings, EPNSSettings } from '@epnsproject/backend-sdk-staging'
import moment from "moment"
import console from 'console';
import { concatAST } from 'graphql';
import userTokenModel from '../models/userTokenModel';

const NETWORK_TO_MONITOR = config.web3MainnetNetwork;
const channelKey = channelWalletsInfo.walletsKV['bprotocolPrivateKey_1']

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
const sdk = new epnsHelper(config.web3KovanProvider, channelKey, settings, epnsSettings)
const epns = sdk.advanced.getInteractableContracts(epnsSettings.network, settings, channelWalletsInfo.walletsKV['bprotocolPrivateKey_1'], epnsSettings.contractAddress, epnsSettings.contractABI)

@Service()
export default class BProtocol {

  public async sendMessageToContract(simulate) {
    logger.debug(`[${new Date(Date.now())}]-[BProtocol]- Checking for new proposals...`);
    // Overide logic if need be
    const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") && simulate.logicOverride.mode ? simulate.logicOverride.mode : false) : false;
    // -- End Override logic
    return await new Promise(async (resolve, reject) => {
      const bprotocol = await sdk.getContract(config.bProtocolDeployedContractMainnet, config.bProtocolDeployedContractABI)
      const bAvatar = await sdk.getContract(config.bAvatar, config.bAvatarABI)
      const users = await sdk.getSubscribedUsers()
      users.map(async (log) => {
        // Get user address
        // const userAddress = log.args.user;
        // console.log(log)
        const userAddress = log
        let avatarAddress = await bAvatar.contract.avatarOf(userAddress)
        console.log(avatarAddress)
        await this.getUsersTotal(bprotocol, NETWORK_TO_MONITOR, userAddress, avatarAddress, simulate)
      })

    })

  }

  public async getUsersTotal(bprotocol, networkToMonitor, userAddress, avatarAddress, simulate) {
    if (!bprotocol) {
      bprotocol = await sdk.getContract(config.bProtocolDeployedContractMainnet, config.bProtocolDeployedContractABI)
    }
    const compound = await sdk.getContract(config.compoundDeployedContractMainnet, config.compComptrollerDeployedContractABI)
    return new Promise((resolve, reject) => {

      this.checkAssets(compound, bprotocol, networkToMonitor, userAddress, avatarAddress)
        .then(async (results: any) => {
          // console.log("res1",results)
          Promise.all(results.allLiquidity)
            .then(async (result: any) => {
              let sumAllLiquidityOfAsset = 0;
              for (let i = 0; i < result.length; i++) {
                sumAllLiquidityOfAsset += result[i];
              }
              logger.info(`[${new Date(Date.now())}]-[BProtocol]- Entire Liquidity Address has: %o | Address: %o `, sumAllLiquidityOfAsset, results.addressName);
              // get 10% of user liquidity
              let liquidityAlert = 10 * sumAllLiquidityOfAsset / 100;
              console.log("alert",liquidityAlert)
              console.log(Math.floor((results.liquidity * 100) / sumAllLiquidityOfAsset))
              // checking if liquidity amount left is below 10%
              if (liquidityAlert > 0 && results.liquidity < liquidityAlert) {
                logger.info(`[${new Date(Date.now())}]-[BProtocol]- Preparing to send notification`);
                const percentage = Math.floor((results.liquidity * 100) / sumAllLiquidityOfAsset);
                const title = "Loan Liquidation Alert!";
                const message = `Your loan in B.Protocol/Compound is approaching liquidation. Currently at ${100-percentage} of your borrow limit.`;
                const payloadTitle = "Loan Liquidation Alert!";
                const payloadMsg = `Your loan in [d:B.Protocol/Compound] is approaching liquidation. Currently at [s:${100-percentage}]% of your borrow limit. [timestamp: ${Math.floor(new Date() / 1000)}]`;
                const notificationType = 3;
                const cta: any = `https://app.bprotocol.org/compound`
                const storageType = 1;
                const trxConfirmWait = 0;
                const payload = await sdk.advanced.preparePayload(results.addressName, notificationType, title, message, payloadTitle, payloadMsg, cta, null)
                const ipfsHash = await sdk.advanced.uploadToIPFS(payload, logger, null, simulate)
                const tx = await sdk.advanced.sendNotification(epns.signingContract, results.addressName, notificationType, storageType, ipfsHash, trxConfirmWait, logger, simulate)
                logger.info(tx);
              }
              else {
                logger.info(`[${new Date(Date.now())}]-[BProtocol]- Date Expiry condition unmet for wallet: : %o `, userAddress);
              }
            })
        })
    })
  }
  public async convertCtoB(bprotocol, assets) {
    const bassets = []
    for (let i = 0; i < assets.length; i++) {
      const baddress = await bprotocol.contract.c2b(assets[i])
      bassets.push(baddress)
    }
    return bassets;
  }

  public async checkAssets(compound, bprotocol, networkToMonitor, userAddress, avatarAddress) {
    if (!compound) {
      compound = await sdk.getContract(config.compoundDeployedContractMainnet, config.compComptrollerDeployedContractABI)
    }
    if (!bprotocol) {
      bprotocol = await sdk.getContract(config.bProtocolDeployedContractMainnet, config.bProtocolDeployedContractABI)
    }
    return new Promise(async (resolve, reject) => {

      let allLiquidity = [];

      let cassets = await compound.contract.getAssetsIn(avatarAddress)
      this.convertCtoB(bprotocol, cassets)
        .then(async (bmarketAddress) => {
          // console.log("bmarket", bmarketAddress)
          // console.log("assets", cassets)

          let bDai = await sdk.getContract(config.bDaiDeployedContract, config.bTokenDeployedContractABI);
          let bBat = await sdk.getContract(config.bBatDeployedContract, config.bTokenDeployedContractABI);
          let bComp = await sdk.getContract(config.bCompDeployedContract, config.bTokenDeployedContractABI)
          let bEth = await sdk.getContract(config.bEthDeployedContract, config.bEthDeployedContractABI);
          let bLink = await sdk.getContract(config.bLinkDeployedContract, config.bTokenDeployedContractABI)
          let bTSUD = await sdk.getContract(config.bTusdDeployedContract, config.bTokenDeployedContractABI)
          let bUni = await sdk.getContract(config.bUniDeployedContract, config.bTokenDeployedContractABI);
          let bUsdt = await sdk.getContract(config.bUsdtDeployedContract, config.bTokenDeployedContractABI);
          let bUsdc = await sdk.getContract(config.bUsdcDeployedContract, config.bTokenDeployedContractABI);
          let bWbtc = await sdk.getContract(config.bWbtcDeployedContract, config.bTokenDeployedContractABI);
          let bZrx = await sdk.getContract(config.bZrxDeployedContract, config.bTokenDeployedContractABI);

          let cDai = await sdk.getContract(config.bCompDaiDeployedContract, config.bCompTokenABI);
          let cBat = await sdk.getContract(config.bCompBatDeployedContract, config.bCompTokenABI);
          let cComp = await sdk.getContract(config.bCompCompDeployedContract, config.bCompTokenABI)
          let cEth = await sdk.getContract(config.bCompEthDeployedContract, config.bCompEthABI);
          let cLink = await sdk.getContract(config.bCompLinkDeployedContract, config.bCompTokenABI)
          let cTSUD = await sdk.getContract(config.bCompTusdDeployedContract, config.bCompTokenABI)
          let cUni = await sdk.getContract(config.bCompUniDeployedContract, config.bCompTokenABI);
          let cUsdt = await sdk.getContract(config.bCompUsdtDeployedContract, config.bCompTokenABI);
          let cUsdc = await sdk.getContract(config.bCompUsdcDeployedContract, config.bCompTokenABI);
          let cWbtc = await sdk.getContract(config.bCompWbtcDeployedContract, config.bCompTokenABI);
          let cZrx = await sdk.getContract(config.bCompZrxDeployedContract, config.bCompTokenABI);
          // let bPrice = await sdk.getContract(config.bPriceOracleDeployedContract, config.bProtocolDeployedContractABI)
          let price = await sdk.getContract(config.bPriceOracleDeployedContract, config.bPriceOracleABI);
          console.log(price)
          // console.log(bPrice)
          // const bCoinObj = {
          //   "0x7776a65d70465bd598ca7e177d7CB62025e5c448": bBat,
          //   "0x930F1d6616de5E5765919863D59354bB3332fB04": bComp,
          //   "0x0b1B0Aa805e48af767a6ec033984f9d7bffb56dd": bDai,
          //   "0x2acf65206bA29E0245B57a5D556Af7340B62eeb5": bEth,
          //   "0x9Edf78ba1d0D6B30dAEb0244Bd59e287a631cEA8": bLink,
          //   "0x1caAE5929c2D33A6e2ba23d85FE3031954dbda70": bTSUD,
          //   "0x1E7C30d49dE4dF2ac86406783ed75B210a277aa9": bUni,
          //   "0xc33E1541dC8C9F4BeCb4517EB1Acc5f8C67E766b": bUsdc,
          //   "0x4B17d8CAB1090A90C5e46045E6faCDB81Ca9BD65": bUsdt,
          //   "0xB6473C402116422f62Ff0ECc4B7E2b71911441AE": bWbtc,
          //   "0x8c4f8f1d867f77251C1a1d470930d5F8E310e8F1": bZrx
          // }
          const bCoinObj = {
            "0x4a77fAeE9650b09849Ff459eA1476eaB01606C7a": bBat,
            "0x930F1d6616de5E5765919863D59354bB3332fB04": bComp,
            "0xF0d0EB522cfa50B716B3b1604C4F0fA6f04376AD": bDai,
            "0x41B5844f4680a8C38fBb695b7F9CFd1F64474a72": bEth,
            "0x9Edf78ba1d0D6B30dAEb0244Bd59e287a631cEA8": bLink,
            "0x1caAE5929c2D33A6e2ba23d85FE3031954dbda70": bTSUD,
            "0x1E7C30d49dE4dF2ac86406783ed75B210a277aa9": bUni,
            "0x4a92E71227D294F041BD82dd8f78591B75140d63": bUsdc,
            "0x3f0A0EA2f86baE6362CF9799B523BA06647Da018": bUsdt,
            "0xa1fAA15655B0e7b6B6470ED3d096390e6aD93Abb": bWbtc,
            "0xAf45ae737514C8427D373D50Cd979a242eC59e5a": bZrx
          }

          const cCoinObj = {
            "0x4a77faee9650b09849ff459ea1476eab01606c7a": cBat,
            "0x930F1d6616de5E5765919863D59354bB3332fB04": cComp,
            "0xf0d0eb522cfa50b716b3b1604c4f0fa6f04376ad": cDai,
            "0x41b5844f4680a8c38fbb695b7f9cfd1f64474a72": cEth,
            "0x9Edf78ba1d0D6B30dAEb0244Bd59e287a631cEA8": cLink,
            "0x1caAE5929c2D33A6e2ba23d85FE3031954dbda70": cTSUD,
            "0x1E7C30d49dE4dF2ac86406783ed75B210a277aa9": cUni,
            "0x4a92e71227d294f041bd82dd8f78591b75140d63": cUsdc,
            "0x3f0a0ea2f86bae6362cf9799b523ba06647da018": cUsdt,
            "0xa1faa15655b0e7b6b6470ed3d096390e6ad93abb": cWbtc,
            "0xaf45ae737514c8427d373d50cd979a242ec59e5a": cZrx
          }
          this.checkLiquidity(bprotocol, networkToMonitor, userAddress)
            .then((results: any) => {
              // console.log(results)

              logger.info(`[${new Date(Date.now())}]-[BProtocol]- Market Address is in: %o | Address: :%o `, bmarketAddress, results.name);

              for (let i = 0; i < bmarketAddress.length; i++) {

                if (bmarketAddress[i] == bmarketAddress[i]) {
                  let bContract = bCoinObj[bmarketAddress[i]];
                  let cContract = cCoinObj[cassets[i].toLowerCase()]
                  let baddress = bmarketAddress[i];
                  let caddress = cassets[i]
                  allLiquidity.push(
                    this.getUserTotalLiquidityFromAllAssetEntered(bContract, cContract, caddress, baddress, compound, price, userAddress, avatarAddress)
                      .then(result => {
                        return result
                      })
                  )
                }
              }

              const liquidity = results.liquidity;
              const addressName = userAddress;

              resolve({
                allLiquidity: allLiquidity,
                liquidity: liquidity,
                addressName: addressName
              });

            })
            .catch(err => {
              logger.error(`[${new Date(Date.now())}]-[BProtocol]- Error occurred in checkLiquidity: %o`, userAddress, err);
              resolve({
                success: false,
                err: err
              });
            })
        })
        .catch(err => {
          logger.error(`[${new Date(Date.now())}]-[BProtocol]- Error occurred in getAssetsIn: %o`, userAddress, err);
          resolve({
            success: false,
            err: err
          });
        })
    });
  }

  public async checkLiquidity(bprotocol, networkToMonitor, userAddress) {
    if (!bprotocol) {
      bprotocol = await sdk.getContract(config.bProtocolDeployedContractMainnet, config.bProtocolDeployedContractABI)
    }
    return new Promise((resolve, reject) => {
      bprotocol.contract.getAccountLiquidity(userAddress)
        .then(result => {
          let { 1: liq } = result;
          liq = ethers.utils.formatEther(liq).toString();

          resolve({
            liquidity: liq,
            name: userAddress
          })


        })
        .catch(err => {
          logger.error(`[${new Date(Date.now())}]-[BProtocol]- Error occurred on Compound Liquidation for Address Liquidation amount: %s: %o`, userAddress, err);
          resolve({
            success: false,
            err: err
          });
        })
    })
  }

  public async getUserTotalLiquidityFromAllAssetEntered(bContract, cContract, caddress, baddress, compound, price, userAddress, avatarAddress) {
    logger.debug(`[${new Date(Date.now())}]-[BProtocol]- Preparing user liquidity info...`);
    return await new Promise((resolve, reject) => {
      let sumCollateral;
      let bTokenBalance;
      let exchangeRateStored;
      let oraclePrice;
      let collateralFactor;

      cContract.contract.getAccountSnapshot(avatarAddress)
        .then(result => {
          let { 1: result1, 3: result2 } = result;
          result2 = (result2 / 1e18)
          result1 = result1 / 1e8
          bTokenBalance = result1;
          exchangeRateStored = result2
          price.contract.getUnderlyingPrice(caddress)
            .then(result => {
              let result3 = (result / 1e18)
              oraclePrice = result3
              compound.contract.markets(caddress)
                .then(result => {
                  let { 1: result4 } = result;
                  result4 = (result4 / 1e18) * 100;
                  collateralFactor = result4;
                  sumCollateral = (bTokenBalance * exchangeRateStored * oraclePrice * collateralFactor) / 1e12;
                  resolve(sumCollateral)
                })
                .catch(err => {
                  logger.error(`[${new Date(Date.now())}]-[BProtocol]- Error occurred while looking at markets: %o`, err);
                  reject(err);
                })
            })
            .catch(err => {
              logger.error(`[${new Date(Date.now())}]-[BProtocol]- Error occurred while looking at getUnderlyingPrice: %o`, err);
              reject(err);
            })
        })
        .catch(err => {
          logger.error(`[${new Date(Date.now())}]-[BProtocol]- Error occurred while looking at getAccountSnapshot: %o`, err);
          reject(err);
        })

    })
  }

}