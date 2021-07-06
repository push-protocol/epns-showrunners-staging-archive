import { Service, Inject } from 'typedi';
import config from '../config';
import channelWalletsInfo from '../config/channelWalletsInfo';
// import PQueue from 'p-queue';
import { ethers, logger } from 'ethers';
import epnsHelper, {InfuraSettings, NetWorkSettings, EPNSSettings} from '@epnsproject/backend-sdk';
const channelKey = channelWalletsInfo.walletsKV['yamGovernancePrivateKey_1'];

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
const sdk = new epnsHelper(config.web3KovanNetwork, channelKey, settings, epnsSettings)

// SET CONSTANTS
const BLOCK_NUMBER = 'block_number';

@Service()
export default class YamGovernanceChannel {
    constructor (
        @Inject('cached') private cached,
    ) {
        //initializing cache
        this.cached.setCache(BLOCK_NUMBER, 0);
    }
    // 
    public async sendMessageToContract(simulate) {
        const cache = this.cached;
        
        logger.debug(`[${new Date(Date.now())}]-[Yam Governance]- Checking for new proposals...`);

        // Overide logic of need be
        const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") && simulate.logicOverride.mode ? simulate.logicOverride.mode : false) : false;

        const epnsNetwork = logicOverride && simulate.logicOverride.hasOwnProperty("epnsNetwork") ? simulate.logicOverride.epnsNetwork : config.web3RopstenNetwork;
        const yamGovernanceNetwork = logicOverride && simulate.logicOverride.hasOwnProperty("yamNetwork") ? simulate.logicOverride.yamNetwork : config.web3KovanNetwork;
        // -- End Override logic

        const yamGov = await sdk.getContract(config.yamGovernanceDeployedContract, config.yamGovernanceDeployedContractABI);

        // Initialize block if that is missing
        let cachedBlock = await cache.getCache(BLOCK_NUMBER);
        console.log("[Yam Governance] CACHED BLOCK", cachedBlock);
        if (!cachedBlock) {
            cachedBlock = 0;
            logger.debug(`[${new Date(Date.now())}]-[Yam Governance]- Initialized flag was not set, first time initalzing, saving latest block of blockchain where everest contract is...`);
            yamGov.provider.getBlockNumber().then((blockNumber) => {
                logger.debug(`[${new Date(Date.now())}]-[Yam Governance]- Current block number is... %s`, blockNumber);
                cache.setCache(BLOCK_NUMBER, blockNumber);
                logger.info("Initialized Block Number: %s", blockNumber);
            })
            .catch(err => {
                logger.debug(`[${new Date(Date.now())}]-[Yam Governance]- Error occurred while getting Block Number: %o`, err);
            })
        }

        // Overide logic if need be
        const fromBlock = logicOverride && simulate.logicOverride.hasOwnProperty("fromBlock") ? Number(simulate.logicOverride.fromBlock): Number(cachedBlock);
        const toBlock = logicOverride && simulate.logicOverride.hasOwnProperty("toBlock") ? Number(simulate.logicOverride.toBlock) : "latest";
        // -- End Override logic
        console.log("yam send_notification fromblock", fromBlock);

        // Check Proposal Created Event
        this.getNewproposals(yamGovernanceNetwork, yamGov, fromBlock, toBlock, simulate)
        .then(async(info: any) => {
            // First save the block number
            cache.setCache(BLOCK_NUMBER, info.lastBlock);

            //Check if there are events else return
            if (info.eventCount == 0) {
                logger.info("No new Proposal...");
            }

            // Otherwise process those proposals
            for(let i = 0; i < info.eventCount; i++) {
                //console.log(info.log[i]);
                let proposer = info.log[i].args.proposer;
                let description = info.log[i].args.description;
                const title = "New Proposal!!🔥🚀";
                const body = proposer + " just Proposed - " + description;
                const payloadTitle = "New Proposal!!🔥🚀";
                const payloadMsg = proposer + " just Proposed - " + description;
                const notificationType = 1;
                const tx = await sdk.sendNotification("0xf69389475E082f4BeFDb9dee4a1E9fe6cd29f6e7", title, body, payloadTitle, payloadMsg, notificationType, simulate);
                logger.info(tx);
            }
        })
        .catch(err => {
            logger.debug(`[${new Date(Date.now())}]-[Yam Governancd]- 🔥Error --> Unable to obtain new proposal's event: %o`, err);
        });
    }
    
    public async getNewproposals(web3network, yamGov, fromBlock, toBlock, simulate) {
        logger.debug(`[${new Date(Date.now())}]-[Yam Governance]- Getting eventLog, eventCount, blocks...`);

        // Check if yamGov is initialised
        if (!yamGov) {
            // check and recreate provider mostly for routes
            logger.info(`[${new Date(Date.now())}]-[Yam Governance]- Mostly coming from routes... rebuilding interactable erc20s`);
            yamGov = await sdk.getContract(config.yamGovernanceDeployedContract, config.yamGovernanceDeployedContractABI);
            logger.info(`[${new Date(Date.now())}]-[Yam Governance]- Rebuilt Yam Governance --> %o`);
        }
        if (!toBlock) {
            logger.info(`[${new Date(Date.now())}]-[Yam Governance]- Mostly coming from routes... resetting toBlock to latest`);
            toBlock = "latest";
        }
        //console.log("yam get_proposal fromblock", fromBlock);

        const cache = this.cached;

        return await new Promise(async(resolve, reject) => {
            const filter = yamGov.contract.filters.ProposalCreated();
            logger.debug(`[${new Date(Date.now())}]-[Yam Governance]- Looking for ProposalCreated() from %d to %s`, fromBlock, toBlock);
            
            yamGov.contract.queryFilter(filter, fromBlock, toBlock)
            .then(async (eventLog) => {
                logger.debug(`[${new Date(Date.now())}]-[Yam Governance]- ProposalCreated() --> %o`, eventLog);

                // Need to fetch latest block
                try {
                    toBlock = await yamGov.provider.getBlockNumber();
                    logger.debug(`[${new Date(Date.now())}]-[Yam Governance]- Latest block updated to --> %s`, toBlock);
                }
                catch (err) {
                    logger.debug(`[${new Date(Date.now())}]-[Yam Governance]- !Errored out while fetching Block Number --> %o`, err);
                }

                const info = {
                    change: true,
                    log: eventLog,
                    blockChecker: fromBlock,
                    lastBlock: toBlock,
                    eventCount: eventLog.length        
                }

                //console.log("yam info", info);
                resolve(info);
                logger.debug(`[${new Date(Date.now())}]-[Yam Governance]- Events retreived for ProposalCreated() call of Yam Governance Contract --> %d Events`, eventLog.length);
            })
            .catch(err => {
                logger.debug(`[${new Date(Date.now())}]-[Yam Governance]- Unable to obtain query filter, error: %o`, err);
                resolve({
                    success: false,
                    err: "Unable to obtain query filter, error: %o" + err
                });
            });
        });
    }
}