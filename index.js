require('dotenv').config();
const { ApolloServer, gql } = require('apollo-server')
const axios = require('axios')

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const batchSize = 10

const typeDefs = gql`
	type Item {
		id: ID!
		name: String!
		shortName: String!
		buyFor: [ItemPrice!]!
		sellFor: [ItemPrice!]!
	}

	type ItemPrice {
		vendor: Vendor!
		price: Int
		currency: String
		currencyItem: Item
		priceRUB: Int
	}

	type Barter {
		id: ID!
		requiredItems: [ContainedItem]!
		rewardItems: [ContainedItem]!
	}

	type ContainedItem {
		item: Item!
		count: Float!
		quantity: Float!
	}

	type Vendor {
		name: String!
		normalizedName: String!
	}

	type ProfitItem {
		buyItem: [ItemDetails!]!
		sellItem: ItemDetails!
		buyPrice: Int!
		sellPrice: Int!
		profit: Int!
	}

	type ItemDetails {
		item: Item!
		count: Int!
	}

	type Query {
		barters: [Barter]
		profit: [ProfitItem]
	}
`

async function fetchDataFromExternalSource() {
	const endpoint = 'https://api.tarkov.dev/'
	const response = await axios.post(endpoint, {
		query: `{
			items {
			  id
			  name
			  normalizedName
			  shortName
			  buyFor {
				price
				vendor {
				  name
				  normalizedName
				}
				currency
				priceRUB
			  }
			  sellFor {
				price
				vendor {
				  name
				  normalizedName
				}
				currency
				priceRUB
			  }
			}
		  }`
	})

	if (response.data.errors) {
		throw new Error('GraphQL query failed.')
	}

	return response.data.data
}

const updateDatabase = async () => {
	console.log('Info: updateDatabase.\n')
	const startTime = Date.now()
	const data = await fetchDataFromExternalSource()
	const batches = Array.from({ length: Math.ceil(data.items.length / batchSize) }, (v, i) =>
		data.items.slice(i * batchSize, i * batchSize + batchSize)
	)

	await batches.reduce((promise, batch) => {
		return promise.then(() =>
			prisma.$transaction(
				batch.map((itemData) => {
					const { buyFor: buyForData, sellFor: sellForData, ...otherItemData } = itemData

					return prisma.item.upsert({
						where: { id: itemData.id },
						update: {
							...otherItemData,
							updated: new Date().toISOString(),
							buyFor: {
								create: buyForData.map((buy) => ({
									price: buy.price,
									currency: buy.currency,
									priceRUB: buy.priceRUB,
									vendor: {
										connectOrCreate: {
											create: { name: buy.vendor.name, normalizedName: buy.vendor.normalizedName },
											where: { name: buy.vendor.name }
										}
									}
								}))
							},
							sellFor: {
								create: sellForData.map((sell) => ({
									price: sell.price,
									currency: sell.currency,
									priceRUB: sell.priceRUB,
									vendor: {
										connectOrCreate: {
											create: { name: sell.vendor.name, normalizedName: sell.vendor.normalizedName },
											where: { name: sell.vendor.name }
										}
									}
								}))
							}
						},
						create: {
							...otherItemData,
							updated: new Date().toISOString(),
							buyFor: {
								create: buyForData.map((buy) => ({
									price: buy.price,
									currency: buy.currency,
									priceRUB: buy.priceRUB,
									vendor: {
										connectOrCreate: {
											create: { name: buy.vendor.name, normalizedName: buy.vendor.normalizedName },
											where: { name: buy.vendor.name }
										}
									}
								}))
							},
							sellFor: {
								create: sellForData.map((sell) => ({
									price: sell.price,
									currency: sell.currency,
									priceRUB: sell.priceRUB,
									vendor: {
										connectOrCreate: {
											create: { name: sell.vendor.name, normalizedName: sell.vendor.normalizedName },
											where: { name: sell.vendor.name }
										}
									}
								}))
							}
						}
					})
				})
			)
		)
	}, Promise.resolve())
	const endTime = Date.now()
	const elapsedTime = ((endTime - startTime) / 1000).toFixed(2)
	console.log(`Success: updateDatabase. Execution time: ${elapsedTime} seconds\n`)
}

updateDatabase()
setInterval(updateDatabase, 15 * 60 * 1000)

const resolvers = {
	Query: {
		barters: async () => {
			const endpoint = 'https://api.tarkov.dev/'
			const response = await axios.post(endpoint, {
				query: `
				{
					barters{
						requiredItems{
							item{
								name
								buyFor{
									vendor{
										name
									}
									priceRUB
								}
							}
							count
						}
						rewardItems{
							item{
								name
								sellFor{
									vendor{
										name
									}
									priceRUB
								}
							}
							count
						}
					}
				}
				`
			})

			if (response.data.errors) {
				throw new Error('GraphQL query failed.')
			}

			return response.data.data.barters
		},
		profit: async () => {
			const endpoint = 'https://api.tarkov.dev/'
			const response = await axios.post(endpoint, {
				query: `
					{
						barters{
							requiredItems{
								item{
									id
									name
									shortName
									buyFor{
										vendor{
											name
										}
										priceRUB
									}
								}
								count
							}
							rewardItems{
								item{
									id
									name
									shortName
									sellFor{
										vendor{
											name
										}
										priceRUB
									}
								}
								count
							}
						}
					}
				`
			})

			if (response.data.errors) {
				throw new Error('GraphQL query failed.')
			}
			const barters = response.data.data.barters
			const profitItems = []
			barters.forEach((bar) => {
				const buyItems = bar.requiredItems
					.map((item) => {
						const priceRUB = (item.item.buyFor && item.item.buyFor[0] && item.item.buyFor[0].priceRUB) || 0

						return {
							item: item.item,
							count: item.count,
							buyPrice: priceRUB * item.count
						}
					})
					.filter((buyItem) => buyItem.buyPrice > 0)
				const validSellFor = bar.rewardItems[0].item.sellFor.filter(
					(vendorInfo) => vendorInfo.vendor.name !== 'Flea Market'
				)

				const maxSellPriceVendor = validSellFor.reduce((prev, curr) => (prev.priceRUB > curr.priceRUB ? prev : curr), {
					priceRUB: 0
				})

				const sellItem = {
					item: {
						...bar.rewardItems[0].item,
						sellFor: maxSellPriceVendor ? [maxSellPriceVendor] : []
					},
					count: bar.rewardItems[0].count,
					sellPrice: maxSellPriceVendor ? maxSellPriceVendor.priceRUB * bar.rewardItems[0].count : 0
				}

				const totalBuyPrice = buyItems.reduce((sum, item) => sum + item.buyPrice, 0)
				const profit = sellItem.sellPrice - totalBuyPrice

				if (profit > 0 && buyItems.length > 0) {
					profitItems.push({
						buyItem: buyItems,
						sellItem: sellItem,
						buyPrice: totalBuyPrice,
						sellPrice: sellItem.sellPrice,
						profit: profit
					})
				}
			})

			return profitItems
		}
	}
}

const server = new ApolloServer({ typeDefs, resolvers })

server.listen().then(({ url }) => {
	console.log(`Server ready at ${url}`)
})
