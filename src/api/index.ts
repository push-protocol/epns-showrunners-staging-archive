import { Router } from 'express';
import LoggerInstance from '../loaders/logger';
import config from '../config'

import fs from 'fs';
const utils = require('../helpers/utilsHelper');

import socketWeb3 from './routes/sockets/socketWeb3';

//import mailing from './routes/mailing';

// guaranteed to get dependencies
export default () => {
	const app = Router();

	// -- SHOWRUNNERS ROUTES
	LoggerInstance.info(`    -- Checking and Loading Dynamic Routes...`);
	const channelFolderPath = `${__dirname}/../showrunners/`
	const directories = utils.getDirectories(channelFolderPath)

  for (const channel of directories) {
    const absPath = `${channelFolderPath}${channel}/${channel}Routes.ts`
    const relativePath = `../showrunners/${channel}/${channel}Routes.ts`

    if (fs.existsSync(absPath)) {
      const cronning = require(absPath)
      cronning.default(app);

      LoggerInstance.info(`     ✔️  ${relativePath} Loaded!`)
    }
    else {
      LoggerInstance.info(`     ❌  ${relativePath} Not Found... skipped`)
    }
  }

  //WALLET MONITORING ROUTES
  LoggerInstance.info(`    -- Checking and Loading Wallet Monitoring Routes...`);
  const absPath = `${__dirname}/routes/walletMonitoringRoutes.ts`
  const relativePath = `./routes/walletMonitoringRoutes.ts`
  const FLAG = config.walletMonitoring;

    if (FLAG === 'ON' || FLAG === 'on') {
      LoggerInstance.info(`     ✔️  Wallet Monitoring is ON`)
      try{
        const cronning = require(absPath)
        cronning.default(app);

        LoggerInstance.info(`     ✔️  ${relativePath} Loaded!`)
      }catch(err){
        LoggerInstance.info(`     ❌  Aborting - Errored while loading Wallet Monitoring Routes - Turn WALLET_MONITORING --> OFF in the env (for development purpose)`)
        process.exit(1)
      }
    }
    else if (FLAG === 'OFF' || FLAG === 'off'){
      LoggerInstance.info(`     ❌  Wallet Monitoring is OFF... ${relativePath} skipped`)
    }

	// SOCKETS
	socketWeb3(app);

	// -- HELPERS
	// For mailing route
	//mailing(app);

	// Finally return app
	return app;
}
