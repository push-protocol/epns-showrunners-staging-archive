import LoggerInstance from '../loaders/logger';
import fs from 'fs';
const utils = require('../helpers/utilsHelper');

let channelKeys={};
async function channelKeysLoader () {
    LoggerInstance.info(`    -- Checking and Loading Dynamic Channel Keys...`);
    const channelFolderPath = `${__dirname}/../showrunners/`
    const directories = utils.getDirectories(channelFolderPath)

    let keys={}
    for (const channel of directories) {
      const absPath = `${channelFolderPath}${channel}/${channel}Keys.json`
      const relativePath = `../showrunners/${channel}/${channel}Keys.json`
      if (fs.existsSync(absPath)) {
        const keysJSON = require(absPath)
        await Object.keys(keysJSON).map(key => keys[key] = keysJSON[key])
        channelKeys[`${channel}`]= keys;
        LoggerInstance.info(`     ✔️  ${relativePath} Loaded!`)
      }
      else {
        LoggerInstance.info(`     ❌  ${relativePath} Not Found... skipped`)
      }
    }
};

export default{
    channelKeysLoader: channelKeysLoader(),
    channelKeys
}
