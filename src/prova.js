const MAMChannel = require('./MAMChannel');

const provider = 'https://nodes.devnet.iota.org';
const mam = new MAMChannel('private', provider, 'askddcnssldw', null);
mam.openChannel();

const listenMAMChannel = async () => {
  try {
    let tmpRoot = mam.getRoot();
    while (true) {
      console.log('Searching for ' + tmpRoot);
      const result = await mam.fetchFrom(tmpRoot);
      if (
        typeof result.messages !== 'undefined' &&
        result.messages.length > 0
      ) {
        result.messages.forEach(message => {
          console.log(message);
        });
        console.log(tmpRoot);
        tmpRoot = result.nextRoot;
        console.log(tmpRoot);
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (error) {
    console.log(error);
  }
};

const ful = async () => {
  try {
    await new Promise(resolve => setTimeout(resolve, 2000));
    await mam.publish({ ciao: 'ciao' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await mam.publish({ ciao: 'ciao1' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await mam.publish({ ciao: 'ciao2' });
  } catch (error) {
    console.log(error);
  }
};

listenMAMChannel();
ful();
