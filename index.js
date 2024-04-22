require('dotenv').config()

const axios = require('axios')
const { get } = require('lodash')
const Discord = require('discord.js')
const client = new Discord.Client({
    partials: ['MESSAGE ']
});
const chainNames = ['eth', 'matic', 'arbitrum', 'base']
const subgraphs = {
	eth: 'https://api.thegraph.com/subgraphs/name/harvestfi/harvest-finance',
	matic: 'https://api.thegraph.com/subgraphs/name/harvestfi/harvest-finance-polygon',
	arbitrum: 'https://api.thegraph.com/subgraphs/name/harvestfi/harvest-finance-arbitrum',
	base: 'https://api.thegraph.com/subgraphs/name/harvestfi/harvest-finance-base',
	zksync: 'https://api.studio.thegraph.com/query/48757/l2-zksync-era/version/latest',
}

const myHeaders = new Headers()
myHeaders.append('Content-Type', 'application/json')

const PRICE_CHECK_INTERVAL = parseInt(process.env.PRICE_CHECK_INTERVAL) || 3600000
const REPEAT_MESSAGE_INTERVAL = parseInt(process.env.REPEAT_MESSAGE_INTERVAL) || 3600000
const FEE_LIMIT = parseFloat(process.env.FEE_LIMIT) || 0.05
const API_KEY = process.env.API_KEY || '41e90ced-d559-4433-b390-af424fdc76d6'

let isPriceChecking = false
let discordChannel = null
let quietTime = 0

const graphql = JSON.stringify({
	query: `{
    priceHistories(
      where:{
      timestamp_gt: ${Math.floor(Date.now()/1000) - 3600*2}
      }
      orderBy: timestamp
      orderDirection: desc
    ) {
      vault {
      id
      symbol
      }
      price
      timestamp
    }
  }`,
	variables: {},
  }),
  requestOptions = {
	method: 'POST',
	headers: myHeaders,
	body: graphql,
	redirect: 'follow',
  }

  const filterDataById = (vaultId, data) => {
    let result = data.filter(item => item.vault.id.toLowerCase() === vaultId.toLowerCase())
    result.sort((a, b) => parseInt(b.timestamp) - parseInt(a.timestamp))
    return result[0]
  }

const priceCheck = async () => {
  let diffData = []
	if (!discordChannel || !isPriceChecking) {
		return
	}

	// check vault
	try {
		const apiData = await axios.get(`http://api.harvest.finance/vaults?key=${API_KEY}`)
    
		const fetchPromises = chainNames.map(async (chainName) => {
      const url = subgraphs[chainName];
      return fetch(url, requestOptions)
        .then(response => response.json())
        .then(res => {
          return res.data.priceHistories;
        })
        .catch(error => {
          console.log('error', error);
          return null;
        });
    });
    
    Promise.all(fetchPromises)
      .then(subgraphDataArray => {
        subgraphDataArray.forEach((subgraphData, index) => {
          const chainName = chainNames[index];
          if (!subgraphData) return; // Skip if there was an error
    
          Object.keys(apiData.data[chainName]).forEach(vaultSymbol => {
            let graphData = filterDataById(apiData.data[chainName][vaultSymbol]?.vaultAddress, subgraphData);
            if (parseFloat(graphData?.price) / parseFloat(apiData.data[chainName][vaultSymbol].usdPrice) < (1 - FEE_LIMIT) || parseFloat(graphData?.price) / parseFloat(apiData.data[chainName][vaultSymbol].usdPrice) > (1 + FEE_LIMIT)) {
              let difference = parseFloat(graphData?.price) / parseFloat(apiData.data[chainName][vaultSymbol].usdPrice)
              diffData.push({
                symbol: apiData.data[chainName][vaultSymbol].id,
                api_price: parseFloat(apiData.data[chainName][vaultSymbol].usdPrice).toFixed(2),
                subgraph_price: parseFloat(graphData.price).toFixed(2),
                difference: difference.toFixed(2) * 100,
                subgraph_price_timestamp: graphData.timestamp
              });
            }
          });
        });
      })
      .then( () => {
        let bSendMessage = true
        quietTime += PRICE_CHECK_INTERVAL

        if (quietTime > REPEAT_MESSAGE_INTERVAL) {
          quietTime = 0
          bSendMessage = true
        }

        if (bSendMessage) {
          console.log(quietTime)
          const embed = new Discord.MessageEmbed()
            .setTitle('Price alerts')
            .setColor(diffData?.length === 0 ? '#5AA27C' : '#D0342C')
          if(diffData.length === 0) {
            embed.addField('Price Status: ', 'OK', true)
            discordChannel.send(embed)
          } else if(diffData.length < 5) {
            diffData.forEach(entry => {
              embed.addField('Symbol', entry.symbol, true)
                .addField('API Price', entry.api_price, true)
                .addField('Subgraph Price', entry.subgraph_price, true)
                .addField('Price Difference', entry.difference +'%', true)
                .addField('Subgraph Price Time', new Date(entry.subgraph_price_timestamp * 1000).toUTCString(), true)
                .addField('\u200B', '\u200B') // Adding a blank field to create space between entries
            })
            discordChannel.send(embed)
          } else {
            const chunkedData = [];
            for (let i = 0; i < diffData.length; i += 4) {
              chunkedData.push(diffData.slice(i, i + 4))
            }
            chunkedData.forEach((chunk, index) => {
              const chunkEmbed = new Discord.MessageEmbed()
                .setTitle(index === 0 ? 'Price alerts' : '')
                .setColor(diffData?.length === 0 ? '#5AA27C' : '#D0342C')
          
              if (chunk.length === 0) {
                chunkEmbed.addField('Price Status: ', 'OK', true)
              }
          
              chunk.forEach(entry => {
                chunkEmbed.addField('Symbol', entry.symbol, true)
                  .addField('API Price', entry.api_price, true)
                  .addField('Subgraph Price', entry.subgraph_price, true)
                  .addField('Price Difference', entry.difference.toFixed(2) +'%', true)
                  .addField('Subgraph Price Time', new Date(entry.subgraph_price_timestamp * 1000).toUTCString(), true)
                  .addField('\u200B', '\u200B') // Adding a blank field to create space between entries
              });
          
              discordChannel.send(chunkEmbed)
            });
          }
          
        }  
      })

	} catch (e) {

		console.log(e)

		const embed = new Discord.MessageEmbed()
			.setTitle('Price Check alerts')
			.setColor('#D0342C')
			.setDescription("There was an error while checking the price check.")
		discordChannel.send(embed)
	}
	
	if (isPriceChecking) {
		setTimeout(priceCheck, PRICE_CHECK_INTERVAL);
	}
}

const startPriceCheck = (channel) => {

	discordChannel = channel
	isPriceChecking = true
	priceCheck()
}

const stopPriceCheck = () => {
	
	isPriceChecking = false
}

client.on("ready", () => {
	console.log("Harvest Api check bot is ready")
	const channel = client.channels.cache.get(process.env.CHANNEL_ID)
    if (channel) {
      startPriceCheck(channel)
    } else {
        console.log("Channel not found")
    }
})
client.on("message", msg => {
	try {
		if (msg.content === "/price-check-test") {

			msg.reply("Harvest price check bot is active now!");
		}
		else if (msg.content == "/price-check-start") {
			startPriceCheck(msg.channel)
			msg.channel.send('Price check started!')
		}
		else if (msg.content == "/price-check-stop") { 
			stopPriceCheck()
			msg.channel.send('Price check stopped!')
		}
		else if (msg.content == "/help") { 
			msg.channel.send('/price-check-start, /price-check-stop')
		}
	} catch (exception) { console.error(exception) }
})

client.login(process.env.BOT_TOKEN)