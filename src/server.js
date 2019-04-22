const Web3 = require('web3');
const MovoContract = require('../build/contracts/Movo');
const MovoAddr = '0xfcCa4e7040176073484ce61889A9723eCa1DDA29';
const PaymentChannelContract = require('../build/contracts/PaymentChannel');
const PaymentChannelAddr = '0x330a2A21C5C1C838676469d4CBC37BD2E48778D6';
const MAMChannel = require('./MAMChannel');

const web3Provider = 'ws://127.0.0.1:7545';
const iotaProvider = 'https://nodes.devnet.iota.org';
const accountNr = 1;

const costPerMessage = 100;

// Must be equal to client and different for each test
const sharedSeed = 'abcdefg123456789';

let web3;
let accounts;
let myAccount;
let otherAccount;
let PaymentChannel;
let myAccountOptions;
let blockNumber;
let balance = 0;
let otherBalance = 0;
let mam;
let stop = false;

const initWeb3AndContracts = async () => {
  web3 = new Web3(web3Provider);
  accounts = await web3.eth.getAccounts();
  myAccount = accounts[accountNr];
  web3.defaultAccount = myAccount;
  console.log('Web3 started');

  myAccountOptions = {
    from: myAccount,
    gas: 6000000
  };

  Movo = new web3.eth.Contract(MovoContract.abi, MovoAddr);
  PaymentChannel = new web3.eth.Contract(
    PaymentChannelContract.abi,
    PaymentChannelAddr
  );
};

const listenPaymentChannelEvent = () => {
  PaymentChannel.events
    .ChannelCreated({
      filter: {
        receiverAddr: myAccount
      }
    })
    .on('data', event => {
      initCommunication(event.returnValues);
    })
    .on('error', console.error);

  console.log('Waiting for Payment Channel to open');
};

const initCommunication = returnValues => {
  otherAccount = returnValues.senderAddr;
  blockNumber = returnValues.blockNumber;

  openMAMChannel();
  listenMAMChannel();
};

const openMAMChannel = () => {
  mam = new MAMChannel('private', iotaProvider, sharedSeed + '9', null);
  mam.openChannel();
  console.log('Opened MAM Channel: ' + mam.getRoot());

  mamClient = new MAMChannel('private', iotaProvider, sharedSeed, null);
  mamClient.openChannel();
  console.log('Listening MAM Channel: ' + mamClient.getRoot());
};

const listenMAMChannel = async () => {
  let tmpRoot = mamClient.getRoot();
  while (!stop) {
    console.log('Searching for ' + tmpRoot);
    const result = await mamClient.fetchFrom(tmpRoot);
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
  if (json.type == 'balance') {
    if (checkSignature(json)) {
      if (json.balance > balance) otherBalance = json.balance;
      const tmp = Math.floor((otherBalance - balance) / costPerMessage);
      for (let i = 0; i < tmp; i++) sendMessage();
    }
  } else if (json.type == 'close') {
    if (checkSignature(json.signature)) {
      console.log('Closed channel');
      sendCloseMessage();
      stop = true;
      //close(json.signature);
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

  data = JSON.stringify({
    data: 'data'
  });

  const dataSign = await signData(data);

  const receiverSign = await signBalance();

  mam.publish({
    type: 'data',
    message: data,
    dataSignature: dataSign,
    balance: balance,
    signature: receiverSign
  });
};

const signData = async data => {
  const dataHash = web3.utils.soliditySha3({
    type: 'string',
    value: data
  });
  return await web3.eth.sign(dataHash, myAccount);
};

const signBalance = async () => {
  const receiverHash = web3.utils.soliditySha3(
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
  return await web3.eth.sign(receiverHash, myAccount);
};

const sendCloseMessage = async () => {
  const receiverSign = await signBalance();

  mam.publish({
    type: 'close',
    message: '',
    balance: balance,
    signature: receiverSign
  });
};

const close = async senderSign => {
  const receiverSign = await signBalance();

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

const main = async () => {
  await initWeb3AndContracts();

  listenPaymentChannelEvent();
};

main();
