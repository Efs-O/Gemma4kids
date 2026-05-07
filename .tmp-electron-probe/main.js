const x = require('electron'); console.log(typeof x, Object.keys(x || {}).slice(0,10)); if (x && x.app) { console.log('hasApp'); x.app.quit(); }
