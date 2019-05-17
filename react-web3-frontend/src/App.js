import React from 'react'
import { ethers } from 'ethers'
import * as ERC20 from 'airswap.js/src/erc20'
import * as tokenMetadata from 'airswap.js/src/tokens'
import * as deltaBalances from 'airswap.js/src/deltaBalances'
import * as dexIndex from 'airswap.js/src/dexIndex'
import * as swap from 'airswap.js/src/swapLegacy'
import Router from 'airswap.js/src/protocolMessaging'

import './App.css'

// you should use a signer most of the time
// https://docs.ethers.io/ethers.js/html/api-wallet.html#signer-api
// for example purposes, we'll just create a new random wallet
const randomWallet = ethers.Wallet.createRandom()

console.log('wallet', randomWallet.address)

console.log('tokenMetadata', tokenMetadata)
console.log('deltaBalances', deltaBalances)
console.log('dexIndex', dexIndex)
console.log('erc20', ERC20)
console.log('swap', swap)

// request an order from an AUTOMATED MAKER for 1000 USDC

// fill that order

// sign an order for a simple token swap on the legacy contract

// sign an order for a fancy nft swap on the new swap contract

// do a simple order sign + order fill example
// swap.signOrder()
// swap.fillOrder()

class App extends React.Component {
  constructor() {
    super()
    this.state = {
      tokens: [],
      tokensBySymbol: {},
      daiBalance: 'fetching...',
      wethBalance: 'fetching...',
      dexIndexData: 'fetching...',
    }

    this.router = new Router({ messageSigner: randomWallet, address: randomWallet.address, keyspace: false })
  }

  componentDidMount = () => {
    // wait until tokenMetadata is ready
    tokenMetadata.ready
      .then(() => {
        const { tokens, tokensBySymbol } = tokenMetadata

        // set metadata in state
        this.setState({ tokens, tokensBySymbol })

        // lookup DAI and WETH balance
        return deltaBalances.getManyBalancesManyAddresses(
          [tokensBySymbol.DAI.address, tokensBySymbol.WETH.address],
          [randomWallet.address],
        )
      })
      .then(balances => {
        // set balances on state
        const daiBalance = balances[randomWallet.address][tokenMetadata.tokensBySymbol.DAI.address]
        const wethBalance = balances[randomWallet.address][tokenMetadata.tokensBySymbol.WETH.address]
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

    // connect to the Router (peer discovery protocol)
    this.router.connect().then(() => {
      console.log('connected to router')
    })
  }

  render() {
    const { tokens, daiBalance, wethBalance, dexIndexData } = this.state
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
      </div>
    )
  }
}

export default App
