import express from "express";
import * as graphql from "graphql";
import { makeExecutableSchema } from "graphql-tools";
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
    rev() {
      return "test";
    },
    async accounts() {
      const [rows] = await db.query("SELECT * FROM accounts");
      return rows;
    },
    async campaigns(obj, args) {
      Object.assign(args, { limit: 100, offset: 0 });
      const [rows] = await db.query("SELECT * FROM campaigns");
      return rows;
    },
    async categories(obj, args) {
      const [rows] = await db.query("SELECT * FROM categories LIMIT 10");
      return rows;
    }
  },
  Account: {
    async campaigns(obj, args) {
      const [rows] = await db.query("SELECT * FROM campaigns");
      return rows;
    }
  },
  Campaign: {
    async categories(obj, args) {
      const [rows] = await db.query("SELECT * FROM categories LIMIT 10");
      return rows;
    }
  }
};

(async function() {
  const schema = true
    ? new graphql.GraphQLSchema({ query: await getQuery() })
    : makeExecutableSchema({
        typeDefs,
        resolvers
      });
  const app = express();
  const server = new ApolloServer({ schema });
  server.applyMiddleware({ app, path: "/graphql" });
  app.listen(4000);
})();
