module.exports = {
  client: {
    excludes: ['../Docs'],
    service: {
      name: 'causasconcursales-server',
      // URL to the GraphQL API
      url: 'http://localhost:4000/graphql',
      endpoint: {
        // localSchemaFile: './gql/typeDefs.gql',
        skipSSLValidation: true // optional, disables SSL validation check
      }
    }
  }
}
