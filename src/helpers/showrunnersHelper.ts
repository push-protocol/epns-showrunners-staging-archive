import { Container } from 'typedi';
import config from '../config';

import { ethers } from 'ethers';

module.exports = {
  // Check if Private Key is valid
  getValidWallet: async function(showrunnerName, wallets) {
    const Cache = Container.get('cached');
    const cacheKeyName = this.getCacheKeyName(showrunnerName);

    const numberOfWallets = Object.keys(wallets).length;
    let selectedWalletID = await Cache.getCache(cacheKeyName);

    if (selectedWalletID) {
      // Cache found, increment it and see if it fits
      selectedWalletID = parseInt(selectedWalletID) + 1;

      if (selectedWalletID > numberOfWallets) {
        selectedWalletID = 1; // Round robin back
      }
    }
    else {
      selectedWalletID = 1;
    }

    const result = await Cache.setCache(cacheKeyName, selectedWalletID);

    return{
      numOfWallets: numberOfWallets,
      currentWalletID: selectedWalletID
    }
  },
  getCacheKeyName: function(showrunnerName) {
    return `${showrunnerName}WalletsMetaCacheKey`;
  },
  getFormattedSchedule: function(rule) {
    let string = "[";
    if (rule.recurs) {
      string += "Repeated -"
    }

    string += this.getFormatScheduleRange(rule.year, "Year")
    string += this.getFormatScheduleRange(rule.month, "Month")
    string += this.getFormatScheduleRange(rule.date, "Date")
    string += this.getFormatScheduleRange(rule.dayOfWeek, "Day of Week")
    string += this.getFormatScheduleRange(rule.hour, "Hour")
    string += this.getFormatScheduleRange(rule.minute, "Minute")
    string += this.getFormatScheduleRange(rule.second, "Second")

    string = string.slice(0, -1)
    string +="]"

    return string;
  },
  getFormatScheduleRange: function(obj, suffix) {
    if (!obj) {
      return ""
    }

    var string = "";

    if (obj.hasOwnProperty('step')) {
      string += ` Every ${obj.step} ${suffix},`
    }
    else {
      string += `| ${obj} ${suffix} |`
    }

    return string;
  }
};
