const Web3 = require('web3');
const Provider = Web3.providers.HttpProvider;
//const Provider = Web3.providers.WebsocketProvider;
const Tx = require('ethereumjs-tx').Transaction;
const Common = require('ethereumjs-common').default;
const Interval = require('interval-promise');

const config = require('./config.json');
const VenusABI = require('./networks/mainnet-abi.json');
const VenusConfig = require('./networks/mainnet.json');

const PriceOracle = VenusConfig.Contracts.VenusPriceOracle;
const PriceOracleABI = VenusABI.PriceOracle;
const VenusLens = VenusConfig.Contracts.VenusLens;
const VenusLensABI = VenusABI.VenusLens;
const Unitroller = VenusConfig.Contracts.Unitroller; // proxy
const ComptrollerABI = require('./abis/Comptroller.json');
const VAIVault = '0x0667Eed0a0aAb930af74a3dfeDD263A73994f216'; // proxy
const VAIVaultABI = require('./abis/VAIVault.json');
const VaiUnitroller = VenusConfig.Contracts.VaiUnitroller;
const VBep20Delegate = require('./abis/VBep20Delegate.json');
const Bep20ABI = require('./abis/BEP20.json');

const web3 = new Web3(new Provider(config.node.provider));
const priceOracle = new web3.eth.Contract(PriceOracleABI, PriceOracle);
const venusLens = new web3.eth.Contract(VenusLensABI, VenusLens);
const unitroller = new web3.eth.Contract(ComptrollerABI, Unitroller);
const vaiVault = new web3.eth.Contract(VAIVaultABI, VAIVault);
const vaiUnitroller = new web3.eth.Contract(ComptrollerABI, VaiUnitroller);
const xvs = new web3.eth.Contract(Bep20ABI, VenusConfig.Contracts.XVS); 
const vai = new web3.eth.Contract(Bep20ABI, VenusConfig.Contracts.VAI);

const bsc = Common.forCustomChain(
  'mainnet',
  { name: 'BSC', networkId: 56, chainId: 56 },
  'istanbul'
);

const tokens = {
  vSXP: '0x2fF3d0F6990a40261c66E1ff2017aCBc282EB6d0',
  vUSDC: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8',
  vUSDT: '0xfD5840Cd36d94D7229439859C0112a4185BC0255',
  vBUSD: '0x95c78222B3D6e262426483D42CfA53685A67Ab9D',
  vBNB: '0xA07c5b74C9B40447a954e1466938b865b6BBea36',
  vXVS: '0x151B1e2635A717bcDc836ECd6FbB62B674FE3E1D',
  vBTC: '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B',
  vETH: '0xf508fCD89b8bd15579dc79A6827cB4686A3592c8',
  vLTC: '0x57A5297F2cB2c0AaC9D554660acd6D385Ab50c6B',
  vXRP: '0xB248a295732e0225acd3337607cc01068e3b9c10',
  vBCH: '0x5F0388EBc2B94FA8E123F404b79cCF5f40b29176',
  vDOT: '0x1610bc33319e9398de5f57B33a5b184c806aD217',
  vLINK: '0x650b940a1033B8A1b1873f78730FcFC73ec11f1f',
  vBETH: '0x972207A639CC1B374B893cc33Fa251b55CEB7c07',
  vDAI: '0x334b3eCB4DCa3593BCCC3c7EBD1A1C1d1780FBF1',
  vFIL: '0xf91d58b5aE142DAcC749f58A49FCBac340Cb0343'
};

// Utils
function toEther(val) {
  val = (typeof val !== 'string' ? (val).toString() : val);
  return Number(Web3.utils.fromWei(val, 'ether'));
}

function toWei(val) {
  val = (typeof val !== 'string' ? (val).toString() : val);
  return Web3.utils.toWei(val, 'ether');
}

function round(value, decimals) {
  return Number(Math.floor(parseFloat(value + 'e' + decimals)) + 'e-' + decimals);
}

function isMatch(val1, val2) {
  if (val1.toLowerCase() == val2.toLowerCase()) {
    return true;
  }
  return false;
}

function getTokenName(address) {
  let result = '-';
  for (let key in tokens) {
    if (isMatch(tokens[key], address)) {
      result = key.substr(1);
      break;
    }
  }
  return result;
}

function getToken(name) {
  return tokens[`v${name}`];
}

function getTokens() {
  return Object.values(tokens);
}

// Transaction
async function getNonce() {
  let address = config.wallet.publicKey;
  let nonce = await web3.eth.getTransactionCount(address, 'pending');
  return nonce;
}

async function sendTransaction(obj) {
  let privateKey = Buffer.from(config.wallet.privateKey, 'hex');
  let tx = new Tx(obj, { common: bsc });
      tx.sign(privateKey);
  let signTx = `0x${tx.serialize().toString('hex')}`;
  let sendTx = await web3.eth.sendSignedTransaction(signTx);
  return sendTx.transactionHash;
}

async function createTransaction(to, data, gas) {
  let txid = '';
  try {
    txid = await sendTransaction({
      nonce: await getNonce(),
      gasPrice: 20000000000, // 20 gwei
      gasLimit: gas,
      data: data,
      to: to,
      value: 0
    });
  } catch (err) {
    // empty
  }
  return txid;
}

async function estimateGas(owner, func) {
  let limit = 1000000;
  let gas = await func.estimateGas({
    from: owner,
    gas: limit,
    value: 0
  });

  if (gas >= limit) {
    throw 'Gas Limit';
  }

  gas = parseInt(gas * 1.2); // fuck it!
  return gas; 
}

// Venus Protocol
async function getOraclePrice(token) {
  let price = await priceOracle.methods.getUnderlyingPrice(token).call();
  return toEther(price);
}

async function getVTokenBalances(tokens = [], owner) {
  return await venusLens.methods.vTokenBalancesAll(tokens, owner).call();
}

async function getVTokens(tokens, owner) {
  let result = [];
  let balances = await getVTokenBalances(tokens, owner);
  for (let val of balances) {
    if (val.balanceOfUnderlying != '0' || val.borrowBalanceCurrent != '0') {
      result.push({
        token: getTokenName(val.vToken),
        supply: toEther(val.balanceOfUnderlying),
        borrow: toEther(val.borrowBalanceCurrent),
        supplyPrice: toEther(val.balanceOfUnderlying) * await getOraclePrice(val.vToken),
        borrowPrice: toEther(val.borrowBalanceCurrent) * await getOraclePrice(val.vToken)
      });
    }
  }
  return result;
}

async function getVAIBorrow(owner) {
  let borrow = await unitroller.methods.mintedVAIs(owner).call();
  return toEther(borrow);
}

async function getVAIStake(owner) {
  let userInfo = await vaiVault.methods.userInfo(owner).call();
  return toEther(userInfo.amount);
}

async function getXVSVault(owner) {
  let pendingXVS = await vaiVault.methods.pendingXVS(owner).call();
  return {
    vault: toEther(pendingXVS),
    price: toEther(pendingXVS) * await getOraclePrice(tokens.vXVS)
  };
}

async function getXVSAccrued(owner) {
  let meta = await venusLens.methods.getXVSBalanceMetadataExt(VenusConfig.Contracts.XVS, VenusConfig.Contracts.Unitroller, owner).call();
  return {
    accrued: toEther(meta.allocated),
    price: toEther(meta.allocated) * await getOraclePrice(tokens.vXVS)
  };
}

async function getVTokenAPY(token) {
  // fucking lazy!
}

async function getVenusAPY(token) {
  let vToken = new web3.eth.Contract(VBep20Delegate, token);
  let venusSpeed = await unitroller.methods.venusSpeeds(token).call();
      venusSpeed = (venusSpeed / 1e18);
  let venusPrice = await priceOracle.methods.getUnderlyingPrice(tokens.vXVS).call();
      venusPrice = (venusPrice / 1e18);
  let tokenPrice = await priceOracle.methods.getUnderlyingPrice(token).call();
      tokenPrice = (tokenPrice / 1e18);
  let exchangeRate = await vToken.methods.exchangeRateCurrent().call();
      exchangeRate = (exchangeRate / 1e18);
  let totalBorrows = await vToken.methods.totalBorrowsCurrent().call();
      totalBorrows = (totalBorrows / 1e18);
  let totalSupply = await vToken.methods.totalSupply().call();
      totalSupply = ((totalSupply * exchangeRate) / 1e18);
  let venusPerDay = (venusSpeed * (20 * 60 * 24));
  return {
    supply: ((Math.pow((1 + (((venusPerDay * venusPrice) / tokenPrice) / totalSupply)), 365) - 1) * 100),
    borrow: ((Math.pow((1 + (((venusPerDay * venusPrice) / tokenPrice) / totalBorrows)), 365) - 1) * 100)
  };
}

async function getVaultAPY(amount = 0) {
  let totalVAI = await vai.methods.balanceOf(VAIVault).call();
      totalVAI = toEther(totalVAI);
  //let totalXVS = await xvs.methods.balanceOf(VAIVault).call();
  //    totalXVS = toEther(totalXVS);
  let venusVAIVaultRate = await unitroller.methods.venusVAIVaultRate().call();
      venusVAIVaultRate = (venusVAIVaultRate / 1e18);
  let venusPerDay = ((amount / totalVAI) * (venusVAIVaultRate * (20 * 60 * 24)));
  let vaiPerYear = ((venusPerDay * await getOraclePrice(tokens.vXVS)) * 365);
  let vaultAPY = ((vaiPerYear * 100) / amount);
  return vaultAPY;
}

// mint, repay, stake, unstake
async function mintVAI(owner, amount) {
  let func = vaiUnitroller.methods.mintVAI(amount);
  let gas = await estimateGas(owner, func);
  let txid = await createTransaction(VaiUnitroller, func.encodeABI(), gas);
  return txid;
}

async function repayVAI(owner, amount) {
  let func = vaiUnitroller.methods.repayVAI(amount);
  let gas = await estimateGas(owner, func);
  let txid = await createTransaction(VaiUnitroller, func.encodeABI(), gas);
  return txid;
}

async function depositVAIVault(owner, amount) {
  let func = vaiVault.methods.deposit(amount);
  let gas = await estimateGas(owner, func);
  let txid = await createTransaction(VAIVault, func.encodeABI(), gas);
  return txid;
}

async function withdrawVAIVault(owner, amount) {
  let func = vaiVault.methods.withdraw(amount);
  let gas = await estimateGas(owner, func);
  let txid = await createTransaction(VAIVault, func.encodeABI(), gas);
  return txid;
}

async function calculator() {
  let owner = config.wallet.publicKey;
  let vTokens = await getVTokens(getTokens(), owner);
  let VAIBorrow = await getVAIBorrow(owner);
  let VAIStake = await getVAIStake(owner);
  let totalSupply = vTokens.reduce((a, b) => (a + b.supplyPrice), 0);
  let totalBorrow = vTokens.reduce((a, b) => (a + b.borrowPrice), 0);
      totalBorrow += VAIBorrow;
  let borrowLimit = (totalSupply * 0.60); // 60% of supply
  let borrowPercent = (totalBorrow / borrowLimit) * 100;
  let liquidity = (borrowLimit - totalBorrow);
  let liquidityPercent = (100 - borrowPercent);

  let XVSVault = await getXVSVault(owner);
  let XVSAccrued = await getXVSAccrued(owner);
  let totalReward = (XVSVault.vault + XVSAccrued.accrued);
  let rewardPrice = (XVSVault.price + XVSAccrued.price); 

  // Simple bot
  let liquidityFix = config.bot.vault.liquidityFix; // lower = risk (liquidation)
  let stakePercent = (100 - (((totalBorrow - VAIBorrow) / borrowLimit) * 100)) - liquidityFix;
  let stakeAmount = round(((borrowLimit * stakePercent) / 100), 2);

  if (config.wallet.privateKey != '-') {
    let VAIEmpty = round((VAIBorrow - VAIStake), 2);
    if (stakeAmount > 0) {
      if (liquidityPercent <= (liquidityFix - 5)) {
        if (VAIStake > stakeAmount) {
          let val = toWei(round((VAIStake - stakeAmount), 2));
          let tx1 = await withdrawVAIVault(owner, val);
          if (tx1 != '') {
            await repayVAI(owner, val);
          }
        } else if (VAIEmpty > 0) {
          await repayVAI(owner, toWei(VAIEmpty));
        }
      } else if (liquidityPercent >= (liquidityFix + 5)) {
        if (stakeAmount > VAIBorrow) {
          let val = toWei(round((stakeAmount - VAIBorrow), 2));
          let tx1 = await mintVAI(owner, val);
          if (tx1 != '') {
            await depositVAIVault(owner, val);
          }
        } else if (VAIEmpty > 0) {
          await depositVAIVault(owner, toWei(VAIEmpty));
        }
      } else if (VAIEmpty > 0) { // repay (tx fail)
        await repayVAI(owner, toWei(VAIEmpty));
      }
    } else if (VAIBorrow > 0) { // unstake & repay
      if (VAIStake > 0) {
        let val = toWei(VAIStake);
        let tx1 = await withdrawVAIVault(owner, val);
        if (tx1 != '') {
          await repayVAI(owner, val);
        }
      } else if (VAIEmpty > 0) {
        await repayVAI(owner, toWei(VAIEmpty));
      }
    }
  }

  // Simple console :)
  let XVSOracle = await getOraclePrice(tokens.vXVS);
  let BNBOracle = await getOraclePrice(tokens.vBNB);

  // XVS Earned (estimated) (supply, borrow)
  let estXVSEarned = 0;
  let estEarnedPrice = 0;
  for (let val of vTokens) {
    let apy = await getVenusAPY(getToken(val.token));
    if (val.supplyPrice > 0) {
      let vaiPerDay = (((val.supplyPrice * apy.supply) / 100) / 365);
      estXVSEarned += (vaiPerDay / XVSOracle);
    }
    if (val.borrowPrice > 0) {
      let vaiPerDay = (((val.borrowPrice * apy.borrow) / 100) / 365);
      estXVSEarned += (vaiPerDay / XVSOracle);
    }
  }
  if (estXVSEarned > 0) {
    estEarnedPrice = (estXVSEarned * XVSOracle);
  }

  // Vault (estimated)
  let estXVSVault = 0;
  let estVaultPrice = 0;
  let vaultAPY = await getVaultAPY(VAIStake);
  if (vaultAPY > 0) {
    estXVSVault = ((((VAIStake * vaultAPY) / 100) / 365) / XVSOracle);
    estVaultPrice = (estXVSVault * XVSOracle);
  }

  console.clear();
  console.log(`[1 XVS = $${round(XVSOracle, 2)} || 1 BNB = $${round(BNBOracle, 2)}]`)
  console.log('===================================')
  console.log(`Supply Balance = $${round(totalSupply, 2)}`)
  console.log(`Borrow Limit = $${round(borrowLimit, 2)}`)
  console.log(`Total Borrow = $${round(totalBorrow, 2)} (${round(borrowPercent, 2)}%)`)
  console.log(`Liquidity = $${round(liquidity, 2)} (${round(liquidityPercent, 2)}%)`)
  console.log('===================================')
  for (let val of vTokens) {
    if (val.supplyPrice >= 0.1) {
      console.log(`${val.token} Supply = ${round(val.supply, 8)} ($${round(val.supplyPrice, 2)})`)
    }
  }
  console.log('===================================')
  console.log(`VAI Borrow = $${VAIBorrow}`)
  for (let val of vTokens) {
    if (val.borrowPrice >= 0.1) {
      console.log(`${val.token} Borrow = ${round(val.borrow, 8)} ($${round(val.borrowPrice, 2)})`)
    }
  }
  console.log('===================================')
  console.log(`VAI Stake = $${VAIStake}`)
  console.log(`Stake Estimated = $${stakeAmount}`)
  console.log('===================================')
  console.log(`XVS Vault = ${round(XVSVault.vault, 8)} ($${round(XVSVault.price, 2)})`)
  console.log(`XVS Earned = ${round(XVSAccrued.accrued, 8)} ($${round(XVSAccrued.price, 2)})`)
  console.log(`Total XVS = ${round(totalReward, 8)} ($${round(rewardPrice, 2)})`)
  console.log('===================================')
  console.log(`Venus Estimated = ${round(estXVSEarned, 8)} ($${round(estEarnedPrice, 2)})`)
  console.log(`Vault Estimated = ${round(estXVSVault, 8)} ($${round(estVaultPrice, 2)})`)
  console.log(`Daily Earnings = ${round((estXVSEarned + estXVSVault), 8)} ($${round((estEarnedPrice + estVaultPrice), 2)})`)
  console.log('===================================')
}

Interval(async () => {
  try {
    await calculator();
  } catch (err) {
    //console.log(err)
  }
}, 10000);
