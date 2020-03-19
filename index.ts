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
import Dataloader from "dataloader";

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

async function select<T>(
  table: string,
  ...fn: ((q: Knex.QueryBuilder) => Knex.QueryBuilder)[]
): Promise<T[]> {
  let select = knex.select().from(table);
  fn.filter(x => x).forEach(fn => (select = fn(select)));
  console.debug(select.toString());
  return select;
}

async function batchSelect<Key, Row>(
  map: Map<Key, { resolved?: boolean; resolve: (x: Row) => void; row?: Row }>,
  table: string,
  column: string,
  key: Key
): Promise<Row> {
  console.log("batchSelect", table, key, map.get(key));
  if (map.get(key)?.resolved) return map.get(key).row;
  return new Promise<Row>(resolve => {
    map.set(key, { resolve });
    setTimeout(async () => {
      if (map.get(key).resolved !== undefined) return;
      const keys = Array.from(map.entries())
        .filter(([, v]) => v.resolved === undefined)
        .map(([k, v]) => (v.resolved = false) || k);
      const rows = await select<Row>(table, q => q.whereIn(column, keys));
      keys.forEach(k => {
        const memo = map.get(k);
        memo.resolved = true;
        memo.row = rows.find(e => e[column] == k);
        memo.resolve(memo.row);
      });
    });
  });
}

async function batchSelect2<Key, Row>(
  map: Map<Key, (row: Row) => void>,
  table: string,
  column: string,
  key: Key
) {
  batch(map, key, async keys => {
    const rows = await select<Row>(table, q => q.whereIn(column, keys));
    keys.forEach(k => map.get(k)?.(rows.find(row => row[column] == k)));
  });
}

async function batch<Key, Row>(
  map: Map<Key, (row: Row) => void>,
  key: Key,
  load: (
    keys: Key[],
    data: Map<Key, ((row: Row) => void) | Row | null | undefined>
  ) => Promise<void>
): Promise<Row> {
  return new Promise<Row>(resolve => {
    map.set(key, undefined);
    setTimeout(async () => {
      console.log(table, key);
      if (map.get(key)) return;
      map.forEach((v, k) =>
        map.set(k, (row: Row) => {
          resolve(row);
          map.delete(k);
        })
      );
      await load(Array.from(map.keys()), map);
    });
  });
}

async function batch2<Key, Value>(keys: Key[], key: Key, fn: (keys: Key[]) => Promise<Value>) {
  if (!keys.includes(key)) keys.push(key);
  return new Promise<Value>(resolve => {
    setTimeout(async () => {
      const copy = keys.slice();
      if (copy.length > 0) {
        resolve(fn(copy));
        keys.length = 0;
      }
    });
  });
}

class BatchLoader<Key, Row> {
  private keys: Key[] = [];
  private rows: Row[] = [];
  private callbacks: ((rows: Row[]) => void)[] = [];
  load(key: Key, load: (keys: Key[]) => Promise<Row[]>): Promise<Row[]> {
    this.keys.push(key);
    return new Promise(resolve => {
      this.callbacks.push(resolve);
      setTimeout(async () => {
        if (this.keys.length == 0) return;
        const keys = this.keys.slice();
        this.keys.length = 0;
        (await load(keys)).forEach(e => this.rows.push(e));
        this.callbacks.forEach(e => e(this.rows));
      });
    });
  }
}

function buildSchema() {
  const schema = buildSchemaFromTypeDefinitions(typeDefs);
  const typeMap = schema.getTypeMap();
  Object.keys(typeMap).forEach(typeName => {
    if (!(typeMap[typeName] instanceof graphql.GraphQLObjectType)) return;
    const type = typeMap[typeName];
    if (type instanceof graphql.GraphQLObjectType) {
      const fields = type.getFields();
      Object.keys(fields).forEach(fieldName => buildResolver(fieldName, fields[fieldName]));
    }
  });
  addSchemaLevelResolveFunction(schema, (obj, args, context, info) => {
    // console.log(obj, args, context, info.path);
  });
  return schema;
}

function sortForDataloader<Key, Row>(
  primaryKey: string,
  keys: readonly Key[],
  rows: readonly Row[]
): (Row | null)[] {
  return keys.map(key => rows.find(e => e[primaryKey] == key) || null);
}

function buildResolver(fieldName: string, field: graphql.GraphQLField<any, any, any>) {
  if (field.resolve) return;
  const directive = field.astNode.directives.find(e =>
    ["table", "belongsTo", "hasMany"].includes(e.name.value)
  );
  if (!directive) return;
  const table = getDirectiveValue(directive, "table") || fieldName;
  const primaryKey = getDirectiveValue(directive, "key") || "id";
  const foreignKey = getDirectiveValue(directive, "foreignKey") || `${fieldName}_id`;
  field.resolve = (obj, args, context, info) => {
    const loader = (function getLoader() {
      if (!context["_loader"]) context["_loader"] = new Map();
      if (context["_loader"].has(table)) return context["_loader"].get(table) as typeof loader;
      const loader = {
        dataloader: new Dataloader(async keys =>
          sortForDataloader(primaryKey, keys, await select(table, q => q.whereIn(primaryKey, keys)))
        ),
        batchLoader: new BatchLoader()
      };
      context["_loader"].set(table, loader);
      return loader;
    })();
    if (field.type instanceof graphql.GraphQLList) {
      if (directive.name.value == "hasMany") {
        return loader.batchLoader
          .load(obj[primaryKey], keys => select(table, q => q.whereIn(foreignKey, keys)))
          .then(rows => rows.filter(row => row[foreignKey] == obj[primaryKey]));
      }
      return select(table, q => q.limit(args.limit || 1000).offset(args.offset || 0));
    } else {
      if (directive.name.value == "belongsTo") {
        return loader.dataloader.load(obj[foreignKey]);
      }
    }
  };
}

function getDirectiveValue(directive: graphql.DirectiveNode, name: string): string | undefined {
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
