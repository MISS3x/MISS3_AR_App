import * as dns from 'dns';

dns.lookup('miss3.cz', (err, addresses) => {
    console.log('miss3.cz:', addresses);
});
dns.lookup('test.miss3.cz', (err, addresses) => {
    console.log('test.miss3.cz:', addresses);
});
dns.lookup('garaz.miss3.cz', (err, addresses) => {
    console.log('garaz.miss3.cz:', addresses);
});
dns.lookup('garaze.miss3.cz', (err, addresses) => {
    console.log('garaze.miss3.cz:', addresses);
});
