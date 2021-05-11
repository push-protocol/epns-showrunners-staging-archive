// @name: Debug
// @version: 1.0.0

import { Service, Inject } from 'typedi';
import config from '../config';
import channelWalletsInfo from '../config/channelWalletsInfo';
import { EventDispatcher, EventDispatcherInterface } from '../decorators/eventDispatcher';
import events from '../subscribers/events';

import { ethers } from 'ethers';

const bent = require('bent'); // Download library
const moment = require('moment'); // time library

const db = require('../helpers/dbHelper');
const utils = require('../helpers/utilsHelper');
import epnsNotify from '../helpers/epnsNotifyHelper';
import { database } from 'firebase-admin';
import { resolve } from 'dns';
const gr = require('graphql-request')
const { request, gql } = gr;

const NETWORK_TO_MONITOR = config.web3RopstenNetwork;

@Service()
export default class Debug {
  constructor(
    @Inject('logger') private logger,
    @EventDispatcher() private eventDispatcher: EventDispatcherInterface,
  ) {}

  public getENSInteractableContract(web3network) {
    return epnsNotify.getInteractableContracts(
        web3network,                                              // Network for which the interactable contract is req
        {                                                                       // API Keys
          etherscanAPI: config.etherscanAPI,
          infuraAPI: config.infuraAPI,
          alchemyAPI: config.alchemyAPI
        },
        null,                                       // Private Key of the Wallet sending Notification
        config.ensDeployedContract,                                             // The contract address which is going to be used
        config.ensDeployedContractABI                                           // The contract abi which is going to be useds
      );
  }

  public getEPNSInteractableContract(web3network) {
    // Get Contract
    return epnsNotify.getInteractableContracts(
        web3network,                                              // Network for which the interactable contract is req
        {                                                                       // API Keys
          etherscanAPI: config.etherscanAPI,
          infuraAPI: config.infuraAPI,
          alchemyAPI: config.alchemyAPI
        },
        channelWalletsInfo.walletsKV['ensDomainExpiryPrivateKey_1'],            // Private Key of the Wallet sending Notification
        config.deployedContract,                                                // The contract address which is going to be used
        config.deployedContractABI                                              // The contract abi which is going to be useds
      );
  }

  // To form and write to smart contract
  public async trackSendNotification(simulate) {
    const logger = this.logger;
    logger.debug('Tracking SendNotification events... ');

    return await new Promise(async(resolve, reject) => {

      // Call Helper function to get interactableContracts
        const epns = this.getEPNSInteractableContract(config.web3RopstenNetwork);

        // Preparing to get all subscribers of the channel
        const channel = await ethers.utils.computeAddress(channelWalletsInfo.walletsKV['everestPrivateKey_1']);
        const startBlock = await epns.contract.channels(channel)
        .then(channelInfo =>{
          const start = channelInfo.channelStartBlock.toNumber();
          logger.info('start: %o', start)
          resolve(start)
        })
        .catch(err => {
          logger.error("🔥 Error : startBlock")
          reject(err)
        })

        logger.info('startBlock: %o', startBlock)

        const filter = epns.contract.filters.SendNotification(channel, null, null)


        // const bal = await epns.provider.getBalance(channel)
        // logger.info('bal: %o ', bal);
        // const balance = ethers.utils.formatEther(bal)
        // logger.info('balance: %o ', balance);

        // epns.contract.queryFilter(filter, 0, 'latest')
        // .then(eventLog => {
        // eventLog.forEach((log) => {
        //   if(log.blockNumber){
        //     // Get user address
        //     const channelAddress = log.args.channel;
        //     const recipientAddress = log.args.recipient;
        //     const identity = log.args.identity;
        //     // const getTransactionReceipt = log.getTransactionReceipt();
        //     const getBlock = log.getBlock();
        //     getBlock
        //     .then(block => {

        //       var a = new Date(block.timestamp * 1000);
        //       var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        //       var year = a.getFullYear();
        //       var month = months[a.getMonth()];
        //       var date = a.getDate();
        //       var hour = a.getHours();
        //       var min = a.getMinutes();
        //       var sec = a.getSeconds();
        //       var time = date + ' ' + month + ' ' + year + ' ' + hour + ':' + min + ':' + sec ;

        //       logger.info('Transaction Hash: %o | Time: %o', log.transactionHash, time);
        //       logger.info("channelAddress: %o | recipientAddress: %o | timestamp: %o", channelAddress, recipientAddress, block.timestamp);

        //     })
        //     .catch(err => {
        //       logger.error("🔥 Error : getBlock()");
        //       reject(err);
        //     })
        //   }
        //   else{
        //     logger.error('Error getting blockNumber')
        //     reject('Error!')
        //   }
            

        //   });
        // })

    });
  }

}
