const { ApolloServer, gql } = require('apollo-server')
const axios = require('axios')

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const typeDefs = gql`
	type User {
		id: ID!
		name: String!
		email: String!
		myPosts: [Post]
	}

	type Post {
		id: ID!
		title: String!
		body: String!
		userId: ID!
	}

	type Item {
		id: ID!
		name: String!
		buyFor: [ItemPrice!]!
	}

	type ItemPrice {
		vendor: Vendor!
		price: Int
		currency: String
		currencyItem: Item
		priceRUB: Int
	}

	interface Vendor {
		name: String!
		normalizedName: String!
	}

	type Query {
		hello(name: String!): String
		users: [User]
		user(id: ID!): User
		posts: [Post]
		items: [Item]
	}
`

const resolvers = {
	Query: {
		hello: (parent, args) => `Hello world! ${args.name}`,
		users: async () => {
			return prisma.user.findMany()
		},
		user: async (parent, args) => {
			let response = await axios.get(`https://jsonplaceholder.typicode.com/users/${args.id}`)
			return response.data
		},
		posts: async () => {
			const res = await axios.get('https://jsonplaceholder.typicode.com/posts')
			return res.data
		},
		items: async () => {
			const endpoint = 'https://api.tarkov.dev/'
			const response = await axios.post(endpoint, {
				query: `
				  {
					items {
					  name
					  buyFor {
						price
						vendor {
						  name
						}
						currency
						priceRUB
					  }
					}
				  }
				`
			})

			if (response.data.errors) {
				throw new Error('GraphQL query failed.')
			}

			return response.data.data.items
		}
	},
	User: {
		myPosts: async (parent) => {
			const response = await axios.get('https://jsonplaceholder.typicode.com/posts')
			const myPosts = response.data.filter((post) => post.userId == parent.id)
			return myPosts
		}
	}
}

const server = new ApolloServer({ typeDefs, resolvers })

server.listen().then(({ url }) => {
	console.log(`Server ready at ${url}`)
})
