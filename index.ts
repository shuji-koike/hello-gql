import express from "express";
import * as graphql from "graphql";
import {
  makeExecutableSchema,
  buildSchemaFromTypeDefinitions,
  addSchemaLevelResolveFunction
} from "graphql-tools";
import { ApolloServer } from "apollo-server-express";
import mysql, { RowDataPacket } from "mysql2/promise";
import { importSchema } from "graphql-import";

var db = mysql.createPool({
  user: "root",
  database: "cirqua_csl"
});

async function table(name: string) {
  return new graphql.GraphQLObjectType({
    name,
    fields: Object.assign(
      {},
      ...(await db.query<RowDataPacket[]>(`DESCRIBE ${name}`))[0].map(e => ({
        [e.Field]: {
          type: getNullable(e, getType(name, e))
        }
      }))
    )
  });
}

async function tableField(name: string) {
  return {
    type: new graphql.GraphQLNonNull(
      new graphql.GraphQLList(new graphql.GraphQLNonNull(await table(name)))
    ),
    args: {
      limit: { type: graphql.GraphQLInt },
      offset: { type: graphql.GraphQLInt }
    },
    async resolve() {
      const [rows] = await db.query(`SELECT * FROM ${name}`);
      return rows;
    }
  };
}

function getType(name: string, e: any): graphql.GraphQLType {
  if (/^(big)?int/.test(e.Type)) return graphql.GraphQLInt;
  if (/^(var)?char/.test(e.Type)) return graphql.GraphQLString;
  if (/^enum/.test(e.Type)) return getEnum(name, e);
  return graphql.GraphQLString;
}

function getNullable(e: any, x: graphql.GraphQLType): graphql.GraphQLType {
  return e.Null == "NO" ? new graphql.GraphQLNonNull(x) : x;
}

function getEnum(name: string, e: any): graphql.GraphQLEnumType {
  return new graphql.GraphQLEnumType({
    name: `${name}_${e.Field}`,
    values: Object.assign(
      {},
      .../\(([^)]+)\)/
        .exec(e.Type)
        ?.pop()
        ?.split(",")
        .map(e => JSON.parse(e.split("'").join('"')))
        .map(e => ({ [e]: { value: e } }))
    )
  });
}

async function getQuery() {
  return new graphql.GraphQLObjectType({
    name: "Query",
    fields: Object.assign(
      {},
      ...(await Promise.all(
        ["accounts", "roles", "campaigns"].map(async e => ({
          [e]: await tableField(e)
        }))
      ))
    )
  });
}

const typeDefs = importSchema("./schema.graphql", {});

const resolvers = {
  Query: {
    accounts: async () => select("accounts"),
    campaigns: async () => select("campaigns"),
    categories: async () => select("categories")
  },
  Account: {
    campaigns: async () => select("campaigns")
  },
  Campaign: {
    categories: async () => select("categories")
  }
};

async function select(table: string, limit: number = 1000, offset: number = 0) {
  const query = `SELECT * FROM ${table} LIMIT ${limit} OFFSET ${offset}`;
  console.log(query);
  const [rows] = await db.query(query);
  return rows;
}

function buildSchema() {
  const schema = buildSchemaFromTypeDefinitions(typeDefs);
  const typeMap = schema.getQueryType();
  const fields = typeMap.getFields();
  Object.keys(fields).forEach(fieldName => {
    if (fields[fieldName].resolve) return;
    const directive = fields[fieldName].astNode.directives.find(
      e => e.name.value == "table"
    );
    if (!directive) return;
    let { type } = fields[fieldName];
    if (type instanceof graphql.GraphQLList) {
      type = type.ofType as graphql.GraphQLOutputType;
    }
    const table =
      directive.arguments
        .filter(e => e.name.value === "table")
        .map(e => e.value.kind === "StringValue" && e.value.value)
        .pop() || fieldName;
    fields[fieldName].resolve = (obj, args, context, info) => {
      console.log(type, obj, args);
      return select(table, args.limit, args.offset);
    };
  });
  addSchemaLevelResolveFunction(schema, (obj, args, context, info) => {
    console.log(obj, args, context, info.path);
  });
  return schema;
}

(async function() {
  const schema = await [
    () => buildSchema(),
    async () => new graphql.GraphQLSchema({ query: await getQuery() }),
    () => makeExecutableSchema({ typeDefs, resolvers })
  ][0]();
  const app = express();
  const server = new ApolloServer({ schema });
  server.applyMiddleware({ app, path: "/graphql" });
  app.listen(4000);
})();
