import * as graphql from "graphql";
import {
  makeExecutableSchema,
  buildSchemaFromTypeDefinitions,
  addSchemaLevelResolveFunction
} from "graphql-tools";
import { importSchema } from "graphql-import";
import express from "express";
import { ApolloServer } from "apollo-server-express";
import mysql, { RowDataPacket } from "mysql2/promise";
import Knex from "knex";

const db = mysql.createPool({
  user: "root",
  database: "cirqua_csl"
});

const knex = Knex({
  client: "mysql2",
  connection: {
    user: "root",
    database: "cirqua_csl"
  }
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

async function select(
  table: string,
  ...fn: ((e: Knex.QueryBuilder) => Knex.QueryBuilder)[]
) {
  let select = knex.select().from(table);
  fn.filter(x => x).forEach(fn => (select = fn(select)));
  if ([true, false][0]) {
    console.log(select.toString());
    return await select;
  }
  const query = `SELECT * FROM ${table}`;
  console.log(query);
  const [rows] = await db.query<RowDataPacket[]>(query);
  return rows;
}

function buildSchema() {
  const schema = buildSchemaFromTypeDefinitions(typeDefs);
  const typeMap = schema.getTypeMap();
  Object.keys(typeMap).forEach(typeName => {
    if (!(typeMap[typeName] instanceof graphql.GraphQLObjectType)) return;
    const type = typeMap[typeName];
    if (type instanceof graphql.GraphQLObjectType) {
      const fields = type.getFields();
      Object.keys(fields).forEach(fieldName =>
        buildResolver(fieldName, fields[fieldName])
      );
    }
  });
  addSchemaLevelResolveFunction(schema, (obj, args, context, info) => {
    // console.log(obj, args, context, info.path);
  });
  return schema;
}

function buildResolver(
  fieldName: string,
  field: graphql.GraphQLField<any, any, any>
) {
  if (field.resolve) return;
  const directive = field.astNode.directives.find(e =>
    ["table", "belongsTo"].includes(e.name.value)
  );
  if (!directive) return;
  const table = getDirectiveValue(directive, "table") || fieldName;
  field.resolve = (obj, args, context, info) => {
    console.log(fieldName, args);
    if (field.type instanceof graphql.GraphQLList) {
      return select(table, s =>
        s.limit(args.limit || 1000).offset(args.offset || 0)
      );
    } else {
      return select(
        table,
        s => s.where({ id: obj[`${fieldName}_id`] }) //TODO
      ).then(e => e.shift());
    }
  };
}

function getDirectiveValue(
  directive: graphql.DirectiveNode,
  name: string
): string | undefined {
  return directive.arguments
    .filter(e => e.name.value === name)
    .map(e => e.value.kind === "StringValue" && e.value.value)
    .pop();
}

(async function() {
  const schema = await [
    async () => buildSchema(),
    async () => new graphql.GraphQLSchema({ query: await getQuery() }),
    async () => makeExecutableSchema({ typeDefs, resolvers })
  ][0]();
  const app = express();
  const server = new ApolloServer({ schema });
  server.applyMiddleware({ app, path: "/graphql" });
  app.listen(4000);
})();
