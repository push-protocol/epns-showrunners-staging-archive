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
const sdk = new epnsHelper(NETWORK_TO_MONITOR, channelKey, settings, epnsSettings)
  

@Service()
export default class bzxChannel {
    constructor(){}

    public async sendMessageToContract(simulate) {
        // Overide logic if need be
        // const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") ? simulate.hasOwnProperty("logicOverride") : false) : false;
        // const epnsNetwork = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("epnsNetwork") ? simulate.logicOverride.epnsNetwork : config.web3RopstenNetwork;
        // const uniswapNetwork = logicOverride && simulate.logicOverride.mode && simulate.logicOverride.hasOwnProperty("uniswapNetwork") ? simulate.logicOverride.uniswapNetwork : NETWORK_TO_MONITOR;
        // -- End Override logic

        // call helper function to get interactableContracts for the bzx contract
        const bzxContract = await sdk.getContract(config.bzxLoanContract, config.bzxLoanDeployedContractABI);
        const isLender = false; //this variable would be false since we are concerned with 'borrowers' instead of lenders
        // next get all the loans which a user has
        const fauxAddress = "0x81016b5fa82b628e7653e63f43882009f90dc2b6";
        const loanCount = (await bzxContract.contract.functions.getUserLoansCount(fauxAddress, isLender)).toString();
        console.log({loanCount: loanCount.toString() });
        // const web3 = new Web3(config.web3MainnetProvider)
        // const networkId = await web3.eth.net.getId();
        // const bzx = await new BZxJS(web3, { networkId , addresses:["0xD8Ee69652E4e4838f2531732a46d1f7F584F0b7f"]});
        // const loans = await bzx.getActiveLoans({ 
        //     start: 10,
        //     count: 1000
        // });
        // console.log({loans});
        const response = {
            success: "success",
            data: "data"
        }
        return response;
    }

}