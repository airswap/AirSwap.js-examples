import React from 'react'
import * as ERC20 from 'airswap.js/src/erc20'
import getSigner from 'airswap.js/src/wallet/getSigner'

import * as tokenMetadata from 'airswap.js/src/tokens'
import * as deltaBalances from 'airswap.js/src/deltaBalances'
import * as dexIndex from 'airswap.js/src/dexIndex'
import * as swap from 'airswap.js/src/swapLegacy'
import Router from 'airswap.js/src/protocolMessaging'

import './App.css'

// you should use a signer most of the time
// https://docs.ethers.io/ethers.js/html/api-wallet.html#signer-api
// for example purposes, we'll just create a new random wallet
const signerPromise = window.ethereum
  .enable()
  .then(async () =>
    getSigner({ web3Provider: window.ethereum })
  )
  .catch(e => {
    alert(`Error connecting metamask: ${e}`)
  })

console.log('tokenMetadata', tokenMetadata)
console.log('deltaBalances', deltaBalances)
console.log('dexIndex', dexIndex)
console.log('erc20', ERC20)
console.log('swap', swap)

class App extends React.Component {
  constructor() {
    super()
    this.state = {
      tokens: [],
      orders: [],
      tokensBySymbol: {},
      isMetadataReady: false,
      daiBalance: 'fetching...',
      wethBalance: 'fetching...',
      dexIndexData: 'fetching...',
    }
    this.ready = signerPromise.then(async wallet => {
      const messageSigner = data => wallet.signMessage(data)
      this.address = (await wallet.getAddress()).toLowerCase()
      this.router = new Router({ messageSigner, address: this.address, keyspace: false })
    })
  }

  componentDidMount = () => {
    // wait until tokenMetadata is ready
    Promise.all([this.ready, tokenMetadata.ready])
      .then(() => {
        const { tokens, tokensBySymbol } = tokenMetadata

        // set metadata in state
        this.setState({ tokens, tokensBySymbol, isMetadataReady: true })
        // lookup DAI and WETH balance
        return deltaBalances.getManyBalancesManyAddresses(
          [tokensBySymbol.DAI.address, tokensBySymbol.WETH.address],
          [this.address],
        )
      })
      .then(balances => {
        // set balances on state
        const daiBalance = balances[this.address][tokenMetadata.tokensBySymbol.DAI.address]
        const wethBalance = balances[this.address][tokenMetadata.tokensBySymbol.WETH.address]
        this.setState({ daiBalance, wethBalance })
      })
      .then(() => {
        // lookup the best price across all DEXes for 30k DAI
        const config = {
          side: 'buy',
          amount: 30000,
          symbol: 'DAI',
        }
        dexIndex.fetchDexIndexPrices(config).then(res => {
          this.setState({ dexIndexData: res })
        })
      })
      .then(() => {
        // connect to the Router (peer discovery protocol)
        return this.router.connect().then(() => {
          console.log('connected to router')
          // request orders for buying 500 DAI for ETH
          return this.getEthOrders({
            amount: 500,
            tokenAddress: tokenMetadata.tokensBySymbol.DAI.address,
            isSell: false,
          })
        })
      })
      .then(orders => {
        // save orders on state
        console.log('we got some order responses back!', orders)
        this.setState({ orders })
      })
  }

  // use the swap protocol to find orders with ETH as the base pair
  async getEthOrders({ amount, tokenAddress, isSell }) {
    const { tokensBySymbol } = this.state
    const makerToken = isSell ? tokensBySymbol.WETH.address : tokenAddress
    const takerToken = isSell ? tokenAddress : tokensBySymbol.ETH.address

    // step 1 - ask the indexer which makers are trading this token
    const intents = await this.router.findIntents([makerToken], [takerToken])
    console.log('intents', intents)

    // step 2 - for each intent, request an order
    const config = {}
    if (isSell) {
      config.takerAmount = tokenMetadata.formatAtomicValueByToken({ address: tokenAddress }, amount)
    } else {
      config.makerAmount = tokenMetadata.formatAtomicValueByToken({ address: tokenAddress }, amount)
    }

    const orders = await this.router.getOrders(intents, config)
    return orders
  }

  render() {
    const { tokens, daiBalance, wethBalance, dexIndexData, orders } = this.state
    return (
      <div className="App">
        <h2>Token Metadata</h2>
        <div className="flex flex-wrap center w-90 flex-row">
          {tokens.slice(0, 20).map((token, idx) => {
            return (
              <div key={idx} className="ma2">
                <img width={25} src={token.airswap_img_url || token.cmc_img_url} />
                <h4>{token.symbol}</h4>

                <textarea value={JSON.stringify(token)} disabled />
              </div>
            )
          })}
        </div>

        <h2>Balance Lookups</h2>
        {/* let's see how much DAI and WETH this user has */}
        <p>Dai Balance: {daiBalance}</p>
        <p>Weth Balance: {wethBalance}</p>

        <h2>DexIndex Price Search</h2>
        {/* let's get some DEX price data for DAI */}
        {JSON.stringify(dexIndexData)}

        <h2>Fetch Price Quotes on the Swap Protocol</h2>
        {orders.map(order => {
          return (
            <div>
              <textarea value={JSON.stringify(order)} disabled />
            </div>
          )
        })}
      </div>
    )
  }
}

export default App
