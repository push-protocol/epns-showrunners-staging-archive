import dotenv from 'dotenv';

// Set the NODE_ENV to 'development' by default
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const envFound = dotenv.config();
if (envFound.error) {
  // This error should crash whole process

  throw new Error("⚠️  Couldn't find .env file  ⚠️");
}

export default {

  aavePrivateKey_1: process.env.AAVE_PRIVATE_KEY,
  
  /**
   * AAVE Related
   */
  aaveLendingPoolDeployedContractKovan: '0xE0fBa4Fc209b4948668006B2bE61711b7f465bAe',
  aaveLendingPoolDeployedContractMainnet: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
  aaveLendingPoolDeployedContractPolygonMainnet: '0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf',
  aaveLendingPoolDeployedContractPolygonMumbai: '0x9198F13B08E299d85E096929fA9781A1E3d5d827',
  aaveLendingPoolDeployedContractABI: require('./aave_LendingPool.json'),

 
};
