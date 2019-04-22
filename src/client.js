const Web3 = require('web3');
const MovoContract = require('../build/contracts/Movo');
const MovoAddr = '0xfcCa4e7040176073484ce61889A9723eCa1DDA29';
const PaymentChannelContract = require('../build/contracts/PaymentChannel');
const PaymentChannelAddr = '0x330a2A21C5C1C838676469d4CBC37BD2E48778D6';
const MAMChannel = require('./MAMChannel');

const web3Provider = 'ws://127.0.0.1:7545';
const iotaProvider = 'https://nodes.devnet.iota.org';
const accountNr = 0;
const otherAccountNr = 1;
const movoOwnerAccountNr = 0;

const costPerMessage = 100;
let wantedDataPackets = 2;
const deposit = wantedDataPackets * costPerMessage;

// Must be equal to server and different for each test
const sharedSeed = 'abcdefg123456789';

let web3;
let accounts;
let myAccount;
let otherAccount;
let Movo;
let PaymentChannel;
let myAccountOptions;
let movoOwnerAccountOptions;
let blockNumber;
let balance = 0;
let otherBalance = 0;
let mam;
let lastBalanceProof;
let stop = false;

const initWeb3AndContracts = async () => {
  web3 = new Web3(web3Provider);
  accounts = await web3.eth.getAccounts();
  myAccount = accounts[accountNr];
  web3.defaultAccount = myAccount;
  otherAccount = accounts[otherAccountNr];
  console.log('Web3 started');

  myAccountOptions = {
    from: myAccount,
    gas: 6000000
  };

  movoOwnerAccountOptions = {
    from: accounts[movoOwnerAccountNr],
    gas: 6000000
  };

  Movo = new web3.eth.Contract(MovoContract.abi, MovoAddr);
  PaymentChannel = new web3.eth.Contract(
    PaymentChannelContract.abi,
    PaymentChannelAddr
  );
};

const openPaymentChannel = async () => {
  await Movo.methods.mint(myAccount, deposit).send(movoOwnerAccountOptions);

  await Movo.methods
    .approve(PaymentChannelAddr, deposit)
    .send(myAccountOptions);

  const receipt = await PaymentChannel.methods
    .createChannel(otherAccount, deposit)
    .send(myAccountOptions);

  blockNumber = receipt.blockNumber;

  console.log(
    'Opened Payment Channel with deposit: ' +
      deposit +
      ' and block number: ' +
      blockNumber
  );
};

const openMAMChannel = () => {
  mam = new MAMChannel('private', iotaProvider, sharedSeed, null);
  mam.openChannel();
  console.log('Opened MAM Channel: ' + mam.getRoot());

  mamServer = new MAMChannel('private', iotaProvider, sharedSeed + '9', null);
  mamServer.openChannel();
  console.log('Listening MAM Channel: ' + mamServer.getRoot());
};

const listenMAMChannel = async () => {
  let tmpRoot = mamServer.getRoot();
  while (!stop) {
    console.log('Searching for ' + tmpRoot);
    const result = await mamServer.fetchFrom(tmpRoot);
    if (typeof result.messages !== 'undefined' && result.messages.length > 0) {
      result.messages.forEach(message => {
        processMessage(message);
      });
      tmpRoot = result.nextRoot;
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }
};

const processMessage = json => {
  console.log('Fetched', json, '\n');
  if (json.type == 'data') {
    if (checkSignature(json)) {
      lastBalanceProof = json.signature;
      if (json.balance > otherBalance) otherBalance = json.balance;
      if (wantedDataPackets > 0 && otherBalance === balance) sendMessage();
      if (wantedDataPackets <= 0 && otherBalance === balance) stop = true;
    }
  } else if (json.type == 'close') {
    if (checkSignature(json.signature)) {
      lastBalanceProof = json.signature;
      sendCloseMessage();
      stop = true;
      close(json.signature);
    }
  }
};

const checkSignature = async message => {
  const balanceHash = web3.utils.soliditySha3(
    {
      type: 'address',
      value: myAccount
    },
    {
      type: 'uint32',
      value: blockNumber
    },
    {
      type: 'uint192',
      value: message.balance
    },
    {
      type: 'address',
      value: PaymentChannelAddr
    }
  );

  const accountRecovered = await web3.eth.accounts.recover(
    balanceHash,
    message.signature
  );

  return accountRecovered === otherAccount;
};

const sendMessage = async () => {
  balance += costPerMessage;
  wantedDataPackets--;

  const senderSign = await signBalance();

  mam.publish({
    type: 'balance',
    message: '',
    balance: balance,
    signature: senderSign
  });
};

const signBalance = async () => {
  const senderHash = web3.utils.soliditySha3(
    {
      type: 'address',
      value: otherAccount
    },
    {
      type: 'uint32',
      value: blockNumber
    },
    {
      type: 'uint192',
      value: balance
    },
    {
      type: 'address',
      value: PaymentChannelAddr
    }
  );
  return await web3.eth.sign(senderHash, myAccount);
};

const sendCloseMessage = async () => {
  const senderSign = await signBalance();

  mam.publish({
    type: 'close',
    message: '',
    balance: balance,
    signature: senderSign
  });
};

const close = async receiverSign => {
  const senderSign = await signBalance();

  console.log('Closing channel...');
  try {
    await PaymentChannel.methods
      .closeChannel(
        otherAccount,
        blockNumber,
        balance,
        senderSign,
        receiverSign
      )
      .send(myAccountOptions);
    console.log('Channel closed');
  } catch (e) {
    console.log(e);
  }
};

const getReceiverCloseSign = async () => {
  const receiverHash = web3.utils.soliditySha3(
    {
      type: 'address',
      value: myAccount
    },
    {
      type: 'uint32',
      value: blockNumber
    },
    {
      type: 'uint192',
      value: balance
    },
    {
      type: 'address',
      value: PaymentChannelAddr
    }
  );

  return await web3.eth.sign(receiverHash, otherAccount);
};

const main = async () => {
  await initWeb3AndContracts();
  await openPaymentChannel();
  openMAMChannel();

  sendMessage();

  await listenMAMChannel();

  await sendCloseMessage();

  await close(lastBalanceProof);

  const myBalance = await Movo.methods.balanceOf(myAccount).call({
    from: myAccount
  });
  console.log('Final Balance: ' + myBalance);

  const receiverBalance = await Movo.methods.balanceOf(otherAccount).call({
    from: myAccount
  });
  console.log('Receiver Balance: ' + receiverBalance);
};

main();
