// @name: Oasis Channel
// @version: 1.0
// @recent_changes: First 

import { Service, Inject, Container } from 'typedi';
import config from '../../config';
import showrunnersHelper from '../../helpers/showrunnersHelper';
import { ethers, logger } from 'ethers';
import epnsHelper, { InfuraSettings, NetWorkSettings, EPNSSettings } from '@epnsproject/backend-sdk-staging'
import Maker from '@makerdao/dai';
import McdPlugin from '@makerdao/dai-plugin-mcd';

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



@Service()
export default class oasisChannel {
    constructor(

        @Inject('logger') private logger,
    ) {
    }
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
        logger.debug(`[${new Date(Date.now())}]-[Oasis]- Looking at vaults for liquidation alert`);
        // Overide logic if need be
        const logicOverride = typeof simulate == 'object' ? (simulate.hasOwnProperty("logicOverride") && simulate.logicOverride.mode ? simulate.logicOverride.mode : false) : false;
        logger.info(`[${new Date(Date.now())}]-[Oasis]- Initialising maker and mcd manager`);
        try {
            const maker = await Maker.create('http', {
                plugins: [McdPlugin],
                url: `https://mainnet.infura.io/v3/${infuraSettings.projectID}`
            });
            const manager = maker.service('mcd:cdpManager');
            const walletKey = await this.getWalletKey()
            const sdk = new epnsHelper(config.web3MainnetNetwork, walletKey, settings, epnsSettings);
            const users = await sdk.getSubscribedUsers()
            for (let i in users) {
                const user = users[i]
                //fetch proxy address set by Oasis:
                const proxyAddress = await maker.service('proxy').getProxyAddress(user);
                if (proxyAddress != null) {
                    logger.info(`[${new Date(Date.now())}]-[Oasis]- User has used Oasis`);

                    await this.getVaultDetails(user, proxyAddress, manager, sdk, simulate)

                }
                else {
                    logger.info(`[${new Date(Date.now())}]-[Oasis]- User has not used Oasis`);

                    continue;
                }
            }
            logger.info(`[${new Date(Date.now())}]-[Oasis]- Finished Oasis logic`);
        }
        catch (error) {
            console.log(error)

        }

    }

    public async getVaultDetails(user: String, proxyAddress: String, manager: any, sdk: any, simulate) {
        try {
            logger.info(`[${new Date(Date.now())}]-[Oasis]- Checking for ${user}`);
            //fetch all vaults
            const data = await manager.getCdpIds(proxyAddress);
            for (let i in data) {
                //fetch details of each vault
                const vault = await manager.getCdp(data[i].id);
                const ilk = vault.ilk
                const vaultid = vault.id
                const collateralAmount = parseFloat(vault.collateralAmount) // amount of collateral tokens
                const collateralValue = vault.collateralValue //// value in USD, using current price feed values
                const debtValue = parseFloat(vault.debtValue)  // amount of Dai debt
                const collateralizationRatio = parseFloat(vault.collateralizationRatio) // collateralValue / debt
                const liquidationPrice = parseFloat(vault.liquidationPrice) // vault becomes unsafe at this price
                const isSafe = vault.isSafe //bool value if vault is safe or not

                const liquidationRatio = (liquidationPrice * collateralAmount) / debtValue;
                logger.info(`[${new Date(Date.now())}]-[Oasis]-  ${liquidationRatio}`);
                logger.info(`[${new Date(Date.now())}]-[Oasis]-  ${collateralizationRatio}`);


                if (isSafe && (collateralizationRatio - liquidationRatio) <= 50) {
                    logger.info(`[${new Date(Date.now())}]-[Oasis]- Vault is safe but is at risk of liquidation`);
                    await this.sendNotification(user, vaultid, 1, collateralizationRatio * 100, liquidationRatio * 100, ilk, simulate)

                }
                if (!isSafe) {
                    logger.info(`[${new Date(Date.now())}]-[Oasis]- Vault is unsafe`);
                    await this.sendNotification(user, vaultid, 2, null, null, ilk, simulate)

                }

            }
        }
        catch (err) {
            console.log("Error: %o", err)
        }

    }

    public async sendNotification(user, vaultid, type, collateralizationRatio = null, liquidationRatio = null, ilk, simulate) {
        let title, message, payloadTitle, payloadMsg, notifType, cta, storageType, trxConfirmWait, payload, ipfsHash, tx
        const walletKey = await this.getWalletKey()
        const sdk = new epnsHelper(config.web3MainnetNetwork, walletKey, settings, epnsSettings);
        const epns = sdk.advanced.getInteractableContracts(config.web3RopstenNetwork, settings, walletKey, config.deployedContract, config.deployedContractABI);
        cta = `https://oasis.app/${vaultid}`

        switch (type) {
            case (1)://for funds about to get liquidated
                logger.info(`[${new Date(Date.now())}]-[Oasis]- Sending notification for vault ${vaultid} which is at risk of liquidation`);
                title = `Vault ${vaultid} is at Risk`
                // message = `Your Vault ${ilk} ${vaultid} is ${Math.floor(percent)}% away from liquidation `
                message = `Your ${ilk} Vault ${vaultid} has reached a collateralization ratio of ${collateralizationRatio}%.\nThe liquidation ratio for this vault is ${liquidationRatio}%.\nClick here to visit your vault!`
                payloadTitle = `Vault ${vaultid} is at Risk`;
                // payloadMsg = `Your Vault [t:${ilk}] [d:${vaultid}] is [s:${percent}]% away from liquidation [timestamp: ${Math.floor(new Date() / 1000)}]`;
                payloadMsg = `Your [t:${ilk}] Vault [d:${vaultid}] has reached a collateralization ratio of [s:${collateralizationRatio}%].\nThe liquidation ratio for this vault is [b:${liquidationRatio}]%.\n\nClick here to visit your vault!`

                notifType = 3;
                storageType = 1;
                trxConfirmWait = 0;
                payload = await sdk.advanced.preparePayload(user, notifType, title, message, payloadTitle, payloadMsg, cta, null)
                ipfsHash = await sdk.advanced.uploadToIPFS(payload, logger, null, simulate)
                tx = await sdk.advanced.sendNotification(epns.signingContract, user, notifType, storageType, ipfsHash, trxConfirmWait, logger, simulate)

                // const tx = await sdk.sendNotification(globalDelegates[k].delegate, title, message, payloadTitle, payloadMsg, notificationType, simulate)
                logger.info(tx);

            case (2)://for funds that are below LR
                logger.info(`[${new Date(Date.now())}]-[Oasis]- Sending notification for vault ${vaultid} which is undercoteralised`);
                title = `Vault ${vaultid} is at Risk`
                message = `Your Vault ${ilk} ${vaultid} is below liquidation ratio.`
                payloadTitle = `Vault ${vaultid} is at Risk`;
                payloadMsg = `Your Vault [t:${ilk}] [d:${vaultid}] is below liquidation ratio. [timestamp: ${Math.floor(new Date() / 1000)}]`;
                notifType = 3;
                storageType = 1;
                trxConfirmWait = 0;
                payload = await sdk.advanced.preparePayload(user, notifType, title, message, payloadTitle, payloadMsg, cta, null)
                ipfsHash = await sdk.advanced.uploadToIPFS(payload, logger, null, simulate)
                tx = await sdk.advanced.sendNotification(epns.signingContract, user, notifType, storageType, ipfsHash, trxConfirmWait, logger, simulate)

                // const tx = await sdk.sendNotification(globalDelegates[k].delegate, title, message, payloadTitle, payloadMsg, notificationType, simulate)
                logger.info(tx);

        }

    }
}