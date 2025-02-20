'use strict'

const fs = require("fs")
const child_process = require('child_process')
const keygen = require('./keygen.js')

const os = require('os')
const platform = os.platform()

const default_config = {
    bin_folder: os.homedir() + '/Documents/komodo/src/',
    chain_name: 'NATURE',
    coin_name: 'NATURE',
    chain_launch_params: '-ac_supply=1999999999 -ac_reward=1000000000 -ac_perc=100000000 -ac_snapshot=1440 -ac_blocktime=120 -ac_cbmaturity=2 -ac_public=1 -ac_cc=666 -ac_adaptivepow=1 -ac_founders=1 -ac_script=a914928d456c145599dad2de18c4afa1cb3c34692ec587 -pubkey=036a07e8ab25e47e15a6fd272195c7c02270e25d9713b439928e76bde021ca9922 -addnode=44.235.28.232 -addnode=44.234.227.211 -addnode=52.40.137.187 -addnode=44.212.140.52 -addnode=3.210.245.206 -printtoconsole'
}

// Example launch command
// /Users/naezith/Documents/komodo/src/komodod -ac_name=NAE -ac_supply=100000 -addnode=95.216.196.64 -ac_cc=1337 -gen -printtoconsole -pubkey=02d8a4e1091ab538769e302ddfe77ca65acca625d79b658b3872172be9b752b23d

// Data
let komodod_path = undefined
let cli_path = undefined
let cli_args = undefined
let keypair = undefined 
let komodod = undefined // This will be the spawned cli komodod object
let config = undefined


function to_cli_args(command) {
    return (cli_args + ' ' + command).split(' ')
}

function readConfig() {
    // Set default
    config = { ...default_config }

    const config_path = getKomodoFolder() + 'gui_config.json'
    try {
        let data = JSON.parse(fs.readFileSync(config_path))

        // Set the value from the file if it exists
        if(data) {
            if(data.bin_folder) config.bin_folder = data.bin_folder
            if(data.chain_name) config.chain_name = data.chain_name
            if(data.coin_name) config.coin_name = data.coin_name
            if(data.chain_launch_params) config.chain_launch_params = data.chain_launch_params
        }

        console.log('Successfully loaded config file: ' + config_path)
    }
    catch(exception) {
        console.log('Config file does not exist or has invalid JSON, generating the default one' + config_path)
    }

    // Write config
    fs.writeFileSync(config_path, JSON.stringify(config))

    console.log('Config: ', config)

    // Set binary variables
    komodod_path = config.bin_folder + 'komodod -ac_name=' + config.chain_name + ' '
    
    // CLI
    cli_path = config.bin_folder + 'komodo-cli'
    cli_args = '-ac_name=' + config.chain_name
}

function prepareDaemon(needs_keygen) {
    return new Promise((resolve, reject) => {
        launchDaemon(keypair.pubkey).then(() => {
            importPrivKey(keypair.privkey).then(() => {
                getAddressFromPubkey(keypair.pubkey).then(addr_info => {
                    keypair.address = addr_info.address
                    keypair.CCaddress = addr_info.CCaddress

                    resolve({ 
                        generated: needs_keygen, 
                        privkey: keypair.privkey, 
                        pubkey: keypair.pubkey, 
                        address: addr_info.address 
                    })
                })
            })
        }).catch(e => {
            console.log('Failed to launch daemon.')
            console.log('Error:', e)
            console.log('Stopping the daemon...')
            stopDaemon().then(() => {
                console.log('Stopped the daemon... Trying to launch daemon again')
                prepareDaemon().then(data => resolve(data))
            })
        })
    })
}


function startUp(pubkey) {
    return new Promise((resolve, reject) => {
        // If pubkey does not exist: It's the first launch, or asks to generate a new key
        let needs_keygen = pubkey === ''

        if(needs_keygen) {
            keypair = keygen.generateKeyPair()
            pubkey = keypair.pubkey

            console.log('Generated pair: ')
            console.log('privkey: ' + keypair.privkey)
            console.log('pubkey: ' + keypair.pubkey)
        }
        // If pubkey exists
        else {
            keypair = { privkey: '', pubkey }
        
            console.log('Launching with existing pubkey:' + pubkey)
        }
            
        // Launch the daemon
        prepareDaemon(needs_keygen).then(data => resolve(data))
    })
}

let daemon_count = 0
function launchDaemon(pubkey) {
    return new Promise((resolve, reject) => {
        let command = komodod_path + config.chain_launch_params + ' -pubkey=' + pubkey

        let args = command.split(' ')
        let program = args.shift()

        console.log('Launching the daemon... \n' + command)
        komodod = child_process.spawn(program, args)
        ++daemon_count

        komodod.stdout.on('data', data => {
            console.log(' komodod ' + daemon_count + ' stdout: ' + data)


            // If it's already open
            if(data.indexOf('Komodo is probably already running') !== -1) {
                reject('Komodo is probably already running')
            }

            // Wait until komodod is ready
            if(data.indexOf('init message: Done loading') !== -1) {
                resolve()
            }

            // If komodod is closed, let stopDaemon function know about it
            if(data.indexOf('Shutdown: done') !== -1) {
                komodod.emit('close', 0)
            }
        })

        komodod.stderr.on('data', data => {
            // This has to be on, daemon doesn't work properly if you don't listen stderr
            //console.log('komodod stderr: ' + data)
        })
    })
}

// CLI
function stopDaemon() {
    return new Promise((resolve, reject) => {
        console.log('Stopping the daemon...')
        child_process.execFile(cli_path, to_cli_args('stop'), (error, stdout, stderr) => {

            // Wait a bit and tell that it's done, not being sure
            let timeout = setTimeout(() => { resolve() }, 20000)

            // If we get a close signal, that's it
            komodod.on('close', code => {
                clearTimeout(timeout)
                
                resolve()
            })
            
        })
    })
}

function getBalance() {
    return new Promise((resolve, reject) => {
        child_process.execFile(cli_path, to_cli_args('getwalletinfo'), (error, stdout, stderr) => {

            if(stderr) {
                console.log('getBalance failed: ', stderr)
                reject(stderr)
            }

            if(stdout) {
                resolve(JSON.parse(stdout).balance)
            }

        })
    })
}

function getNewAddress() {
    return new Promise((resolve, reject) => {
        child_process.execFile(cli_path, to_cli_args('getnewaddress'), (error, stdout, stderr) => {

            if(stderr) {
                console.log('getNewAddress failed: ', stderr)
                reject(stderr)
            }

            if(stdout) {
                resolve(stdout)
            }

        })
    })
}


function getTokenBalance(id) {
    return new Promise((resolve, reject) => {
        child_process.execFile(cli_path, to_cli_args('tokenbalance ' + id), (error, stdout, stderr) => {

            if(stderr) {
                console.log('getTokenBalance failed: ', stderr)
                reject(stderr)
            }

            if(stdout) {
                resolve(JSON.parse(stdout).balance)
            }

        })
    })
}

function getTokenName(id) {
    return new Promise((resolve, reject) => {
        child_process.execFile(cli_path, to_cli_args('tokeninfo ' + id), (error, stdout, stderr) => {

            if(stderr) {
                console.log('getTokenName failed: ', stderr)
                reject(stderr)
            }

            if(stdout) {
                resolve(JSON.parse(stdout).name)
            }

        })
    })
}


function getTokenList() {
    return new Promise((resolve, reject) => {
        child_process.execFile(cli_path, to_cli_args('tokenlist'), (error, stdout, stderr) => {

            if(stderr) {
                console.log('getTokenList failed: ', stderr)
                reject(stderr)
            }

            if(stdout) {
                let tokens = JSON.parse(stdout)

                tokens.forEach((tok, i, arr) => {
                    arr[i] = { id: tok }
                })
    
                // Get token information
                Promise.all(tokens.map(t => {
                    return new Promise((resolve, reject) => {
                        // Get name and balance
                        Promise.all([
                            getTokenName(t.id).then(name => { t.name = name; }),
                            getTokenBalance(t.id).then(balance => { t.balance = balance; })                        
                        ]).then(() => { resolve() })
                    })
                })).then(() => { resolve(tokens) })
            }

        })
    })
}

function getTokenOrders() {
    return new Promise((resolve, reject) => {
        child_process.execFile(cli_path, to_cli_args('tokenorders'), (error, stdout, stderr) => {

            if(stderr) {
                console.log('getTokenOrders failed: ', stderr)
                reject(stderr)
            }

            if(stdout) {
                let orders = JSON.parse(stdout)
    
                // Get token information
                Promise.all(orders.map(t => {
                    return new Promise((resolve, reject) => {
                        // Get name and balance
                        Promise.all([
                            getTokenName(t.tokenid).then(name => { t.name = name; })                     
                        ]).then(() => { resolve() })
                    })
                })).then(() => { resolve(orders) })
            }

        })
    })
}

function importPrivKey(key) {
    console.log('Importing privkey: ' + key)
    return new Promise((resolve, reject) => {
        if(key === '') {
            console.log('No need to import privkey, it is empty.')
            return resolve('empty_key')
        }

        child_process.execFile(cli_path, to_cli_args('importprivkey ' + key), (error, stdout, stderr) => {

            if(stderr) {
                console.log('importPrivKey failed: ', stderr)
                reject(stderr)
            }

            if(stdout) {
                console.log('importprivkey result address: ' + stdout)
                resolve(stdout)
            }

        })
    })
}

function getAddressFromPubkey(pubkey) {
    return new Promise((resolve, reject) => {
        child_process.execFile(cli_path, to_cli_args('tokenaddress ' + pubkey), (error, stdout, stderr) => {

            if(stderr) {
                console.log('getAddressFromPubkey failed: ', stderr)
                reject(stderr)
            }

            if(stdout) {
                let json = JSON.parse(stdout)
                resolve({ address: json.myaddress, CCaddress: json.CCaddress, } )
            }

        })
    })
}



function sendToAddress(address, amount) {
    return new Promise((resolve, reject) => {
        console.log('Sending ' + amount + ' ' + getCoinName() + ' to ' + address)
        const cli = child_process.execFile(cli_path, to_cli_args('sendtoaddress ' + address + ' ' + amount), (error, stdout, stderr) => {

            if(stderr) {
                console.log('sendToAddress failed: ', stderr)
                reject(stderr)
            }

            if(stdout) {
                console.log('sendtoaddress ' + address + ' ' + amount)
                console.log('txid: ' + stdout)
                resolve(stdout)
            }

        })
    })
}



function broadcastTX(raw_tx) {
    return new Promise((resolve, reject) => {
        child_process.execFile(cli_path, to_cli_args('sendrawtransaction ' + raw_tx), (error, stdout, stderr) => {

            if(stderr) {
                console.log('BroadcastTX Failed: ' + stderr)
                reject(stderr)
            }

            if(stdout) {
                console.log('TX-ID result: ' + stdout)
                resolve(stdout)
            }

        })
    })
}

function sendTokenToAddress(token_id, address, amount) {
    return new Promise((resolve, reject) => {
        console.log('Sending ' + amount + ' of token_id: ' + token_id + ' to ' + address)
        child_process.execFile(cli_path, to_cli_args('tokentransfer ' + token_id + ' ' + address + ' ' + amount), (error, stdout, stderr) => {

            if(stderr) {
                console.log('sendTokenToAddress failed: ', stderr)
                reject(stderr)
            }

            if(stdout) {
                console.log('tokentransfer ' + address + ' ' + amount)
    
                broadcastTX(JSON.parse(stdout).hex).then(txid => {
                    resolve(txid)
                }).catch(e => {
                    reject(e)
                })
            }

        })

    })
}



function createToken(name, supply, description) {
    return new Promise((resolve, reject) => {
        console.log('Creating token ' + name + ', supply: ' + supply + ' description: ' + description)
        
        let args = to_cli_args('tokencreate ' + name + ' ' + supply)
        if(description !== '') args.push('"' + description + '"')

        child_process.execFile(cli_path, args, (error, stdout, stderr) => {

            if(stderr) {
                console.log('createToken failed: ', stderr)
                reject(stderr)
            }

            if(stdout) {
                console.log('Broadcasting tokencreate...')
                broadcastTX(JSON.parse(stdout).hex).then(txid => {
                    resolve(txid)
                }).catch(e => {
                    reject(e)
                })
            }

        })
    })
}


function createTokenTradeOrder(action, supply, tokenid, price) {
    return new Promise((resolve, reject) => {
        console.log('Creating token buy order supply:' + supply + ', tokenid: ' + tokenid + ', price: ' + price)
        
        child_process.execFile(cli_path, to_cli_args('token' + (action === 'buy' ? 'bid' : 'ask')
                                            + ' ' + supply + ' ' + tokenid + ' ' + price), (error, stdout, stderr) => {

            if(stderr) {
                console.log('createTokenTradeOrder failed: ', stderr)
                reject(stderr)
            }

            if(stdout) {
                console.log('Broadcasting create trade order... ' + action)
                broadcastTX(JSON.parse(stdout).hex).then(txid => {
                    resolve(txid)
                }).catch(e => {
                    reject(e)
                })
            }

        })
    })
}

function fillTokenOrder(func, tokenid, txid, count) {
    return new Promise((resolve, reject) => {
        console.log('Filling order token order:' + func + ', tokenid: ' + tokenid + ', txid: ' + txid + ' count: ' + count)
        
        child_process.execFile(cli_path, to_cli_args('tokenfill' + (func === 'buy' ? 'ask' : 'bid')
                                            + ' ' + tokenid + ' ' + txid + ' ' + count), (error, stdout, stderr) => {

            if(stderr) {
                console.log('fillTokenOrder failed: ', stderr)
                reject(stderr)
            }

            if(stdout) {
                console.log('Broadcasting fill order... ' + func)
                broadcastTX(JSON.parse(stdout).hex).then(txid => {
                    resolve(txid)
                }).catch(e => {
                    reject(e)
                })
            }

        })
    })
}

function cancelTokenOrder(action, tokenid, txid) {
    return new Promise((resolve, reject) => {
        console.log('Cancelling order token order:' + action + ', tokenid: ' + tokenid + ', txid: ' + txid)
        
        const cli = child_process.execFile(cli_path, to_cli_args('tokencancel' + action + ' ' + tokenid + ' ' + txid), (error, stdout, stderr) => {

            if(stderr) {
                console.log('cancelTokenOrder failed: ', stderr)
                reject(stderr)
            }

            if(stdout) {
                console.log('Broadcasting cancel order... ' + action)
                broadcastTX(JSON.parse(stdout).hex).then(txid => {
                    resolve(txid)
                }).catch(e => {
                    reject(e)
                })
            }
            
        })
    })
}


function getCoinName() {
    return config.coin_name
}

function getChainName() {
    return config.chain_name
}


function getKeyPair() {
    return keypair
}

function getKomodoFolder() {
    // macOS
    if(platform === 'darwin') 
        return os.homedir() + '/Library/Application Support/Komodo/' + config.chain_name + '/'  

    // Windows
    if(platform === 'win32') 
        return process.env.APPDATA + '\\Komodo\\' + config.chain_name + '\\' 

    // Probably Linux
    return os.homedir() + '/.komodo/' + config.chain_name + '/'  
}

module.exports = {
    startUp,
    stopDaemon,
    getBalance,
    getChainName,
    getCoinName,
    getKomodoFolder,
    sendToAddress,
    getNewAddress,
    getTokenList,
    getKeyPair,
    sendTokenToAddress,
    createToken,
    createTokenTradeOrder,
    getTokenOrders,
    fillTokenOrder,
    cancelTokenOrder,
    readConfig
} 
