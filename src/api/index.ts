import { Router } from 'express';
import LoggerInstance from '../loaders/logger';

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
    const relativePath = `../showrunners-sdk/${channel}/${channel}Routes.ts`

    if (fs.existsSync(absPath)) {
      const cronning = require(absPath)
      cronning.default(app);

      LoggerInstance.info(`     ✔️  ${relativePath} Loaded!`)
    }
    else {
      LoggerInstance.info(`     ❌  ${relativePath} Not Found... skipped`)
    }
  }

	// SOCKETS
	socketWeb3(app);

	// -- HELPERS
	// For mailing route
	//mailing(app);

	// Finally return app
	return app;
}
