import React from 'react'
import { ethers } from 'ethers'
import * as ERC20 from 'airswap.js/src/erc20'
import getSigner from 'airswap.js/src/wallet/getSigner'
import * as tokenMetadata from 'airswap.js/src/tokens'
import * as deltaBalances from 'airswap.js/src/deltaBalances'
import * as dexIndex from 'airswap.js/src/dexIndex'
import * as swap from 'airswap.js/src/swapLegacy'
import * as swapSimple from 'airswap.js/src/swap'
import Router from 'airswap.js/src/protocolMessaging'

import './App.css'

// there's many ways to get a signer with ethers.js, in this example we'll use MetaMask
const signerPromise = window.ethereum
  .enable()
  .then(async () => getSigner({ web3Provider: window.ethereum }))
  .catch(e => {
    alert(`Error connecting metamask: ${e}`)
  })

// token names, addresses, symbols, images, and lots of helpful functions for things like decimal conversion
console.log('tokenMetadata', tokenMetadata)
// utility functions to fetch users' token balances, useful for wallets and trading
console.log('deltaBalances', deltaBalances)
// dexindex api wrapper, allows you to search for the best price for any arbitrary token across all DEX's
console.log('dexIndex', dexIndex)
// erc20 helper functions; approve tokens to be moved by other smart contracts, wrap/unwrap weth, etc.
console.log('erc20', ERC20)
// the bare minimum AirSwap functions: signOrder and fillOrder. User A signs an order with signOrder() and sends it to User B. User B submits that order to fillOrder() and the swap executes. that's it!
console.log('simple swap functions', swap)
// this contains helpers to facilitate the full Swap protocol
console.log('swap protocol message router', Router)

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
      formTakerAddress: '',
      formTakerParam: '',
      formTakerToken: '',
      formMakerToken: '',
      formMakerParam: '',
      signedOrder: 'Paste a generated signed order here!',
      generatedSignedOrder: {},
    }
    // wait to initialize the app until we have our signer (aka our wallet) ready to go
    this.ready = signerPromise.then(async wallet => {
      const messageSigner = data => wallet.signMessage(data)
      this.address = (await wallet.getAddress()).toLowerCase()
      this.router = new Router({ messageSigner, address: this.address, keyspace: false })
    })
  }

  componentDidMount = () => {
    // wait until tokenMetadata is ready
    Promise.all([this.ready, tokenMetadata.ready]).then(() => {
      const { tokens, tokensBySymbol } = tokenMetadata

      // set metadata in state
      this.setState({ tokens, tokensBySymbol, isMetadataReady: true })
      // lookup DAI and WETH balance
      return deltaBalances.getManyBalancesManyAddresses(
        [tokensBySymbol.DAI.address, tokensBySymbol.WETH.address],
        [this.address],
      )
    })
    // .then(balances => {
    //   // set balances on state
    //   const daiBalance = balances[this.address][tokenMetadata.tokensBySymbol.DAI.address]
    //   const wethBalance = balances[this.address][tokenMetadata.tokensBySymbol.WETH.address]
    //   this.setState({ daiBalance, wethBalance })
    // })
    // .then(() => {
    //   // lookup the best price across all DEXes for 30k DAI
    //   const config = {
    //     side: 'buy',
    //     amount: 30000,
    //     symbol: 'DAI',
    //   }
    //   dexIndex.fetchDexIndexPrices(config).then(res => {
    //     this.setState({ dexIndexData: res })
    //   })
    // })
    // .then(() => {
    //   // connect to the Router (peer discovery protocol)
    //   return this.router.connect().then(() => {
    //     console.log('connected to router')
    //     // request orders for buying 500 DAI for ETH
    //     return this.getEthOrders({
    //       amount: 50,
    //       tokenAddress: tokenMetadata.tokensBySymbol.DAI.address,
    //       isSell: false,
    //     })
    //   })
    // })
    // .then(orders => {
    //   // save orders on state
    //   console.log('we got some order responses back!', orders)
    //   this.setState({ orders })
    // })
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
    const config = {
      makerToken,
      takerToken,
      takerAddress: this.address.toLowerCase(),
    }
    if (isSell) {
      config.takerAmount = tokenMetadata.formatAtomicValueByToken({ address: tokenAddress }, amount)
    } else {
      config.makerAmount = tokenMetadata.formatAtomicValueByToken({ address: tokenAddress }, amount)
    }

    const orderPromises = []

    intents.forEach(({ address, makerToken, takerToken }) => {
      orderPromises.push(this.router.getOrder(address, config).catch(e => e))
    })

    const orders = await Promise.all(orderPromises).catch(e => e)
    return orders
  }

  handleInputChange = (id, e) => {
    const { value } = e.target
    this.setState({ [id]: value })
  }

  async createSignedOrder() {
    const {
      formTakerAddress,
      formTakerParam,
      formTakerToken,
      formMakerToken,
      formMakerParam,
      tokensBySymbol,
    } = this.state

    const signer = await getSigner({ web3Provider: window.ethereum })

    const makerToken = tokensBySymbol[formMakerToken.toUpperCase()].address
    const takerToken = tokensBySymbol[formTakerToken.toUpperCase()].address

    const order = {
      makerAddress: this.address.toLowerCase(),
      makerAmount: tokenMetadata.formatAtomicValueByToken({ address: makerToken }, formMakerParam),
      makerToken,
      takerAddress: formTakerAddress.toLowerCase(),
      takerAmount: tokenMetadata.formatAtomicValueByToken({ address: takerToken }, formTakerParam),
      takerToken,
      expiration: Date.now(),
      nonce: Date.now(),
    }

    const signedOrder = await swap.signOrder(order, signer)
    console.log('signedOrder', signedOrder)
    return signedOrder
  }

  async fillOrder() {
    const order = JSON.parse(this.state.signedOrder)
    const signer = await getSigner({ web3Provider: window.ethereum })
    const params = {
      gasLimit: 250000,
      gasPrice: ethers.utils.parseUnits('20', 'gwei').toNumber(),
    }
    console.log(order)
    swap.fillOrder(order, signer, params).then(receipt => console.log('filled order success!', receipt))
  }

  render() {
    const { tokens, daiBalance, wethBalance, dexIndexData, orders, generatedSignedOrder, signedOrder } = this.state
    return (
      <div className="App">
        <div className="mb7">
          <h2 className="f2">Token Metadata</h2>
          <div className="flex flex-wrap center w-90 flex-row">
            {tokens.slice(0, 30).map((token, idx) => {
              return (
                <div key={idx} className="ma2">
                  <img width={25} src={token.airswap_img_url || token.cmc_img_url} />
                  <h4>{token.symbol}</h4>

                  <textarea value={JSON.stringify(token)} disabled />
                </div>
              )
            })}
          </div>
        </div>
        <div className="mb7">
          <h2 className="f2">Balance Lookups</h2>
          {/* let's see how much DAI and WETH this user has */}
          <p>Dai Balance: {daiBalance}</p>
          <p>Weth Balance: {wethBalance}</p>
        </div>

        <div className="mb7">
          <h2 className="f2">DexIndex Price Search</h2>
          {/* let's get some DEX price data for DAI */}
          {JSON.stringify(dexIndexData)}
        </div>

        <div className="mb7">
          <h2 className="f2">Fetch Price Quotes on the Swap Protocol</h2>
          {/* We got some orders back! These orders could be filled by simply calling swapLegacy.fillOrder() and passing the signed order object! */}
          {orders.map((order, idx) => {
            return (
              <div key={idx}>
                <textarea value={JSON.stringify(order)} disabled />
              </div>
            )
          })}
        </div>

        <div className="mb7">
          <h2 className="f2">Simple Swap</h2>
          <h3 className="f3">Create Order</h3>
          {/* Generate a simple swap order that you can send over email, twitter, telegram, or whatever! */}
          <form className="mb5">
            makerAddress: {this.address}
            <div>
              <input
                required
                value={this.state.formTakerAddress}
                onChange={this.handleInputChange.bind(this, 'formTakerAddress')}
                placeholder="takerAddress"
              />
            </div>
            <div>
              <input
                required
                value={this.state.formMakerToken}
                placeholder="maker token symbol"
                onChange={this.handleInputChange.bind(this, 'formMakerToken')}
              />
            </div>
            <div>
              <input
                required
                value={this.state.formTakerToken}
                placeholder="taker token symbol"
                onChange={this.handleInputChange.bind(this, 'formTakerToken')}
              />
            </div>
            <div>
              <input
                required
                value={this.state.formMakerParam}
                placeholder="makerAmount"
                onChange={this.handleInputChange.bind(this, 'formMakerParam')}
              />
            </div>
            <div>
              <input
                required
                value={this.state.formTakerParam}
                placeholder="takerAmount"
                onChange={this.handleInputChange.bind(this, 'formTakerParam')}
              />
            </div>
            <button
              type="submit"
              onClick={e => {
                e.preventDefault()
                this.createSignedOrder().then(order => this.setState({ generatedSignedOrder: order }))
              }}
            >
              Generate Order
            </button>
            <div className="mv4">Signed Order Object:</div>
            <div>
              <textarea disabled value={JSON.stringify(generatedSignedOrder)} />
            </div>
          </form>

          <h3 className="f3">Fill order</h3>
          <textarea
            onChange={e => {
              this.setState({ signedOrder: e.target.value })
            }}
            value={signedOrder}
          />
          <div>
            <button onClick={this.fillOrder.bind(this)}>Fill Order</button>
          </div>
        </div>
      </div>
    )
  }
}

export default App
